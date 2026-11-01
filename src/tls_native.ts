import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Target } from "./target.ts";

// The TLS half of the runtime, over OpenSSL, compiled into a program only when its IR calls
// `fsh_rt_tls_`, after the rest of the runtime, whose socket calls reach it through a socket's
// `tls_ops`. A TLS stream is a TcpStream whose reads and writes go through its SSL object.
export const TLS_NATIVE = String.raw`
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509v3.h>

// A stream's SSL object, or a listener's context its connections are made from. A clone of a
// stream may read on one thread while another writes, and OpenSSL's calls on one SSL object
// mustn't overlap, so each call holds the lock; none holds it while waiting.
typedef struct { SSL_CTX *ctx; SSL *ssl; pthread_mutex_t lock; } fsh_tls;

// OpenSSL writes to the socket itself, without the MSG_NOSIGNAL Linux needs to keep a closed
// peer from ending the program with SIGPIPE, so the signal is held back on this thread while it
// works, and one that came is taken. macOS sockets are made with SO_NOSIGPIPE.
#ifdef __APPLE__
#define FSH_TLS_QUIET(before) (void)(before)
#define FSH_TLS_LOUD(before) (void)(before)
#else
#define FSH_TLS_QUIET(before) fsh_tls_quiet(&(before))
#define FSH_TLS_LOUD(before) fsh_tls_loud(&(before))
static void fsh_tls_quiet(sigset_t *before) {
  sigset_t pipe_only;
  sigemptyset(&pipe_only);
  sigaddset(&pipe_only, SIGPIPE);
  pthread_sigmask(SIG_BLOCK, &pipe_only, before);
}
static void fsh_tls_loud(sigset_t *before) {
  sigset_t pending, pipe_only;
  sigemptyset(&pipe_only);
  sigaddset(&pipe_only, SIGPIPE);
  sigpending(&pending);
  if (sigismember(&pending, SIGPIPE) && !sigismember(before, SIGPIPE)) {
    int taken;
    sigwait(&pipe_only, &taken);
  }
  pthread_sigmask(SIG_SETMASK, before, NULL);
}
#endif

// Node's codes for the certificate failures a client meets most.
static const char *fsh_tls_code(long verify) {
  switch (verify) {
    case X509_V_ERR_HOSTNAME_MISMATCH:
    case X509_V_ERR_IP_ADDRESS_MISMATCH: return "ERR_TLS_CERT_ALTNAME_INVALID";
    case X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY: return "UNABLE_TO_GET_ISSUER_CERT_LOCALLY";
    case X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE: return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    case X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT: return "DEPTH_ZERO_SELF_SIGNED_CERT";
    case X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN: return "SELF_SIGNED_CERT_IN_CHAIN";
    case X509_V_ERR_CERT_HAS_EXPIRED: return "CERT_HAS_EXPIRED";
    case X509_V_ERR_CERT_NOT_YET_VALID: return "CERT_NOT_YET_VALID";
    default: return "EPROTO";
  }
}

// What a failed SSL call means, with the lock held: 0 to wait, the way to wait in *writing; 1 for
// the end of the stream, when reading; or 5 with the reason. number is errno from the call.
static int32_t fsh_tls_failed(fsh_tls *t, int ret, int number, int reading, const char *syscall, int32_t *writing, fsh_str **message) {
  int error = SSL_get_error(t->ssl, ret);
  if (error == SSL_ERROR_WANT_READ || error == SSL_ERROR_WANT_WRITE) {
    *writing = error == SSL_ERROR_WANT_WRITE;
    return 0;
  }
  int handshake = !SSL_is_init_finished(t->ssl);
  if (error == SSL_ERROR_ZERO_RETURN && reading) return 1;
  long verify = SSL_get_verify_result(t->ssl);
  char text[320];
  int32_t failed;
  if (verify != X509_V_OK) {
    snprintf(text, sizeof text, "certificate verify failed: %s", X509_verify_cert_error_string(verify));
    failed = fsh_io_parts(message, text, fsh_tls_code(verify), syscall, NULL);
  } else if (error == SSL_ERROR_SYSCALL && number != 0) {
    errno = number;
    failed = fsh_io_failed(message, reading ? "can't read" : "can't write", syscall);
  } else if (error == SSL_ERROR_SYSCALL || error == SSL_ERROR_ZERO_RETURN) {
    failed = fsh_io_parts(message, handshake ? "the connection closed during the TLS handshake" : "the peer closed the TLS connection", "ECONNRESET", syscall, NULL);
  } else {
    const char *why = ERR_reason_error_string(ERR_peek_last_error());
    snprintf(text, sizeof text, "%s: %s", handshake ? "the TLS handshake failed" : "TLS failed", why ? why : "unknown error");
    failed = fsh_io_parts(message, text, "EPROTO", syscall, NULL);
  }
  ERR_clear_error();
  return failed;
}

static int32_t fsh_tls_read(fsh_socket *s, int64_t max, fsh_task *task, fsh_array *out, fsh_str **message) {
  fsh_tls *t = s->tls;
  char buffer[65536];
  size_t n = 0;
  int32_t writing = 0, done = 2;
  sigset_t before;
  pthread_mutex_lock(&t->lock);
  FSH_TLS_QUIET(before);
  ERR_clear_error();
  errno = 0;
  int ok = SSL_read_ex(t->ssl, buffer, (size_t)(max < (int64_t)sizeof buffer ? max : (int64_t)sizeof buffer), &n);
  if (!ok) done = fsh_tls_failed(t, ok, errno, 1, "read", &writing, message);
  FSH_TLS_LOUD(before);
  pthread_mutex_unlock(&t->lock);
  if (done == 2) {
    char *data = fsh_rt_alloc(n);
    memcpy(data, buffer, n);
    *out = (fsh_array){data, (int64_t)n, (int64_t)n};
    return 1;
  }
  if (done == 1) *out = (fsh_array){NULL, 0, 0};
  if (done == 0) fsh_io_wait(s->fd, writing, task);
  return done;
}

// Sends what is left past *written, finishing the handshake first, so writing nothing finishes
// it alone. A retried SSL_write_ex is given the same bytes, as OpenSSL requires.
static int32_t fsh_tls_write(fsh_socket *s, fsh_array *bytes, int64_t *written, fsh_task *task, fsh_str **message) {
  fsh_tls *t = s->tls;
  int32_t writing = 0, done = 1;
  sigset_t before;
  pthread_mutex_lock(&t->lock);
  FSH_TLS_QUIET(before);
  ERR_clear_error();
  errno = 0;
  if (!SSL_is_init_finished(t->ssl)) {
    int ok = SSL_do_handshake(t->ssl);
    if (ok != 1) done = fsh_tls_failed(t, ok, errno, 0, "write", &writing, message);
  }
  while (done == 1 && *written < bytes->length) {
    size_t n = 0;
    errno = 0;
    int ok = SSL_write_ex(t->ssl, bytes->data + *written, (size_t)(bytes->length - *written), &n);
    if (ok) *written += (int64_t)n;
    else done = fsh_tls_failed(t, ok, errno, 0, "write", &writing, message);
  }
  FSH_TLS_LOUD(before);
  pthread_mutex_unlock(&t->lock);
  if (done == 0) fsh_io_wait(s->fd, writing, task);
  return done;
}

static fsh_tls *fsh_tls_new(SSL_CTX *ctx, SSL *ssl) {
  fsh_tls *t = fsh_rt_alloc(sizeof(fsh_tls));
  t->ctx = ctx;
  t->ssl = ssl;
  pthread_mutex_init(&t->lock, NULL);
  return t;
}

static const fsh_tls_ops fsh_tls_calls;

// A listener's new connection, which handshakes as the server inside its first read or write.
static int fsh_tls_accepted(fsh_socket *listener, fsh_socket *conn) {
  SSL *ssl = SSL_new(((fsh_tls *)listener->tls)->ctx);
  if (!ssl) return 0;
  SSL_set_fd(ssl, conn->fd);
  SSL_set_accept_state(ssl);
  conn->tls = fsh_tls_new(NULL, ssl);
  conn->tls_ops = &fsh_tls_calls;
  return 1;
}

// Sends close_notify when it can without waiting, so the peer sees a clean end.
static void fsh_tls_release(fsh_socket *s) {
  fsh_tls *t = s->tls;
  if (t->ssl) {
    sigset_t before;
    FSH_TLS_QUIET(before);
    if (SSL_is_init_finished(t->ssl)) SSL_shutdown(t->ssl);
    SSL_free(t->ssl);
    ERR_clear_error();
    FSH_TLS_LOUD(before);
  }
  SSL_CTX_free(t->ctx);
  pthread_mutex_destroy(&t->lock);
  fsh_rt_free(t);
  s->tls = NULL;
}

static const fsh_tls_ops fsh_tls_calls = { fsh_tls_read, fsh_tls_write, fsh_tls_accepted, fsh_tls_release };

static SSL_CTX *fsh_tls_context(int server) {
  SSL_CTX *ctx = SSL_CTX_new(server ? TLS_server_method() : TLS_client_method());
  if (!ctx) return NULL;
  SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
  // A peer that closes without close_notify ends the stream, as HTTP servers often do.
  SSL_CTX_set_options(ctx, SSL_OP_IGNORE_UNEXPECTED_EOF);
  if (!server) SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
  return ctx;
}

// The client context trusting the system's certificates, made once, since loading them takes a
// while: OpenSSL's default paths, which a Homebrew OpenSSL points at the bundle it keeps.
static SSL_CTX *fsh_tls_system;
static pthread_once_t fsh_tls_system_once = PTHREAD_ONCE_INIT;
static void fsh_tls_system_load(void) {
  fsh_tls_system = fsh_tls_context(0);
  if (fsh_tls_system) SSL_CTX_set_default_verify_paths(fsh_tls_system);
}

// A BIO over a string's bytes.
static BIO *fsh_tls_bio(fsh_str *pem) {
  return BIO_new_mem_buf(pem->bytes, (int)pem->length);
}

static fsh_str *fsh_tls_said(const char *text) {
  return fsh_rt_str_from_cstring(text);
}

// Starts TLS as the client on a connected stream, verifying the server's certificate for name, a
// host name or an IP address, against the PEM certificates in ca, or the system's when ca is
// empty, as Node's ca option does. Gives why it can't, or an empty string.
fsh_str *fsh_rt_tls_client(fsh_socket *s, fsh_str *name, fsh_str *ca) {
  char *host = fsh_rt_str_cstring(name);
  if (!host || !host[0]) {
    fsh_rt_free(host);
    return fsh_tls_said("the server name to verify is empty or holds a NUL byte");
  }
  SSL_CTX *ctx;
  if (ca->length == 0) {
    pthread_once(&fsh_tls_system_once, fsh_tls_system_load);
    ctx = fsh_tls_system;
    if (ctx) SSL_CTX_up_ref(ctx);
  } else {
    ctx = fsh_tls_context(0);
    int trusted = 0;
    if (ctx) {
      BIO *bio = fsh_tls_bio(ca);
      X509 *cert;
      while ((cert = PEM_read_bio_X509(bio, NULL, NULL, NULL))) {
        X509_STORE_add_cert(SSL_CTX_get_cert_store(ctx), cert);
        X509_free(cert);
        trusted++;
      }
      BIO_free(bio);
      ERR_clear_error();
    }
    if (ctx && !trusted) {
      SSL_CTX_free(ctx);
      fsh_rt_free(host);
      return fsh_tls_said("the 'ca' option holds no PEM certificate");
    }
  }
  SSL *ssl = ctx ? SSL_new(ctx) : NULL;
  if (!ssl) {
    SSL_CTX_free(ctx);
    fsh_rt_free(host);
    ERR_clear_error();
    return fsh_tls_said("can't set up TLS");
  }
  SSL_set_fd(ssl, s->fd);
  SSL_set_connect_state(ssl);
  // An address is checked against the certificate's IP addresses and isn't sent as SNI, which
  // takes only names.
  unsigned char address[16];
  if (inet_pton(AF_INET, host, address) == 1 || inet_pton(AF_INET6, host, address) == 1) X509_VERIFY_PARAM_set1_ip_asc(SSL_get0_param(ssl), host);
  else {
    SSL_set_tlsext_host_name(ssl, host);
    SSL_set1_host(ssl, host);
  }
  fsh_rt_free(host);
  s->tls = fsh_tls_new(ctx, ssl);
  s->tls_ops = &fsh_tls_calls;
  return fsh_tls_said("");
}

// Has a listener's connections speak TLS as the server, with the PEM certificate chain in cert
// and its private key in key. Gives why it can't, or an empty string.
fsh_str *fsh_rt_tls_listen(fsh_socket *listener, fsh_str *cert, fsh_str *key) {
  SSL_CTX *ctx = fsh_tls_context(1);
  if (!ctx) return fsh_tls_said("can't set up TLS");
  const char *why = NULL;
  BIO *bio = fsh_tls_bio(cert);
  X509 *leaf = PEM_read_bio_X509(bio, NULL, NULL, NULL);
  if (!leaf || !SSL_CTX_use_certificate(ctx, leaf)) why = "the TLS 'cert' holds no PEM certificate";
  X509_free(leaf);
  X509 *more;
  while (!why && (more = PEM_read_bio_X509(bio, NULL, NULL, NULL))) {
    if (!SSL_CTX_add0_chain_cert(ctx, more)) X509_free(more);
  }
  BIO_free(bio);
  if (!why) {
    bio = fsh_tls_bio(key);
    EVP_PKEY *pkey = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
    BIO_free(bio);
    if (!pkey || !SSL_CTX_use_PrivateKey(ctx, pkey)) why = "the TLS 'key' holds no PEM private key";
    else if (!SSL_CTX_check_private_key(ctx)) why = "the TLS 'key' isn't the private key of the 'cert' certificate";
    EVP_PKEY_free(pkey);
  }
  ERR_clear_error();
  if (why) {
    SSL_CTX_free(ctx);
    return fsh_tls_said(why);
  }
  listener->tls = fsh_tls_new(ctx, NULL);
  listener->tls_ops = &fsh_tls_calls;
  return fsh_tls_said("");
}
`;

// The runtime's TLS calls where OpenSSL wasn't found: each says why and how to get it.
export function tlsStub(why: string): string {
  const said = JSON.stringify(why);
  return String.raw`
fsh_str *fsh_rt_tls_client(fsh_socket *s, fsh_str *name, fsh_str *ca) {
  return fsh_rt_str_from_cstring(${said});
}

fsh_str *fsh_rt_tls_listen(fsh_socket *listener, fsh_str *cert, fsh_str *key) {
  return fsh_rt_str_from_cstring(${said});
}
`;
}

// Where OpenSSL is for a target: the flags to compile and link the TLS runtime with, or why it
// isn't there.
export type OpenSsl = { compile: string[]; link: string[] } | { missing: string };

const found = new Map<string, OpenSsl>();

// OpenSSL for `target`: on this machine through pkg-config, else Homebrew's openssl@3, else the
// system's headers; for another target or a sysroot, only in the sysroot, never this machine's.
export function findOpenSsl(target: Target): OpenSsl {
  const key = target.compile.join("\0");
  let got = found.get(key);
  if (!got) found.set(key, (got = search(target)));
  return got;
}

const LIBS = ["-lssl", "-lcrypto"];
const INSTALL = "install it (brew install openssl@3 on macOS, apt install libssl-dev on Debian and Ubuntu, apk add openssl-dev on Alpine) and build the program again";

function search(target: Target): OpenSsl {
  const at = target.compile.indexOf("--sysroot");
  const sysroot = at >= 0 ? target.compile[at + 1] : undefined;
  if (sysroot !== undefined || target.compile.includes("-target")) {
    if (sysroot !== undefined && existsSync(join(sysroot, "usr", "include", "openssl", "ssl.h"))) return { compile: [], link: LIBS };
    const local = sysroot === undefined ? undefined : join(sysroot, "usr", "local");
    if (local !== undefined && existsSync(join(local, "include", "openssl", "ssl.h"))) return { compile: ["-I", join(local, "include")], link: ["-L", join(local, "lib"), ...LIBS] };
    const where = sysroot === undefined ? "no sysroot was given" : `the sysroot ${sysroot} has no OpenSSL headers`;
    return { missing: `TLS needs OpenSSL built for ${target.triple}, and ${where}; install OpenSSL's headers and libraries into a sysroot for that target and build the program again` };
  }
  if (Bun.which("pkg-config")) {
    const asked = Bun.spawnSync(["pkg-config", "--cflags", "--libs", "openssl"]);
    if (asked.exitCode === 0) {
      const flags = asked.stdout.toString().trim().split(/\s+/).filter((f) => f !== "");
      return { compile: flags.filter((f) => f.startsWith("-I")), link: flags.filter((f) => !f.startsWith("-I")) };
    }
  }
  for (const dir of ["/opt/homebrew/opt/openssl@3", "/usr/local/opt/openssl@3"]) {
    if (existsSync(join(dir, "include", "openssl", "ssl.h"))) return { compile: ["-I", join(dir, "include")], link: ["-L", join(dir, "lib"), ...LIBS] };
  }
  if (existsSync("/usr/include/openssl/ssl.h")) return { compile: [], link: LIBS };
  return { missing: `TLS needs OpenSSL, which wasn't found when this program was built; ${INSTALL}` };
}
