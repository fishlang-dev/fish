import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { changed, changes, contentsOf, exited, listening, SETTLE_MS, settled, shown, signalled, snapshot, stopped, watchedFiles, type Signals } from "./watch.fsh";

// One build of the handlers: whether it built, the files it read or looked for, and the shapes of
// the state it keeps, one per line.
export type Handlers = { built: boolean; loaded: string[]; shapes: string };
// What `fishc dev` runs: the entry, its scratch directory, which holds the host, the handlers and
// the control file, and the two builds. `handlers` builds the library at the path it is given.
export type Developing = { entry: string; dir: string; manifest?: string; host: () => boolean; handlers: (out: string) => Handlers; done: () => void };

const SHAPE = "; fsh.devstate ";

// The shapes of the state a build of the handlers keeps across loads, as codegen marks them.
export function stateShapes(ir: string): string {
  let shapes = new Set<string>();
  let at = ir.indexOf(SHAPE);
  while (at >= 0) {
    const end = ir.indexOf("\n", at);
    shapes.add(ir.slice(at + (SHAPE.length as i64), end < 0 ? (ir.length as i64) : end));
    at = ir.indexOf(SHAPE, at + 1);
  }
  let sorted = [...shapes];
  sorted.sort();
  return sorted.join("\n");
}

// The host's whole program: it loads what `control` names, and serves.
export function hostSource(control: string): string {
  return `async function main(): Promise<void> throws IoError {\n  await __devHost(${JSON.stringify(control)});\n}\n`;
}

// What the host hands each load of the handlers, laid out alike on both sides.
const HOST_TABLE = String.raw`#include <stdint.h>
typedef struct fishdev_host {
  int64_t (*next)(void *load);
  const char *(*request)(int64_t job);
  void (*reply)(int64_t job, const uint8_t *bytes, int64_t length);
  void (*listen)(void *load, const char *hostname, int64_t port);
  void *(*state)(const char *key, int64_t index);
  void (*keep)(const char *key, int64_t index, void *block);
} fishdev_host;
`;

// The host's C half. A load is a library and the thread running its main; a job is one request
// waiting for its reply. Each load takes jobs from its own queue, and new jobs go to the load that
// called serve last. A load is never closed, so the code behind state it kept stays.
// ponytail: one lock and one condition for everything, and the control file polled every 100 ms;
// enough for one developer's requests.
export const HOST_C = HOST_TABLE + String.raw`
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct job { char *request; char *reply; int done; struct job *next; } job;
typedef struct load { char *path; job *head; job *tail; int serving; } load;
typedef struct kept { char *key; int64_t index; void *block; struct kept *next; } kept;

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t moved = PTHREAD_COND_INITIALIZER;
static load *current;
static char *hostname;
static int64_t port = -1;
static char *control;
static char *loaded;
static kept *keeps;

static int64_t next_job(void *self) {
  load *l = self;
  pthread_mutex_lock(&lock);
  while (l->head == NULL) pthread_cond_wait(&moved, &lock);
  job *j = l->head;
  l->head = j->next;
  if (l->head == NULL) l->tail = NULL;
  pthread_mutex_unlock(&lock);
  return (int64_t)(intptr_t)j;
}

static const char *request_of(int64_t id) {
  return ((job *)(intptr_t)id)->request;
}

static void reply_to(int64_t id, const uint8_t *bytes, int64_t length) {
  job *j = (job *)(intptr_t)id;
  char *text = malloc((size_t)length + 1);
  memcpy(text, bytes, (size_t)length);
  text[length] = 0;
  pthread_mutex_lock(&lock);
  j->reply = text;
  j->done = 1;
  pthread_cond_broadcast(&moved);
  pthread_mutex_unlock(&lock);
}

static void listening(void *self, const char *name, int64_t at) {
  load *l = self;
  pthread_mutex_lock(&lock);
  int first = current == NULL;
  int moved_away = !first && (at != port || strcmp(name, hostname) != 0);
  if (first) {
    hostname = strdup(name);
    port = at;
  }
  current = l;
  l->serving = 1;
  pthread_cond_broadcast(&moved);
  pthread_mutex_unlock(&lock);
  if (moved_away) fprintf(stderr, "[fishc] serve now names %s:%lld, but the host keeps listening where it started; restart fishc dev to move it\n", name, (long long)at);
  if (!first) fprintf(stderr, "[fishc] reloaded the handlers; connections and state were kept\n");
}

static void *state_of(const char *key, int64_t index) {
  void *found = NULL;
  pthread_mutex_lock(&lock);
  for (kept *k = keeps; k != NULL; k = k->next)
    if (k->index == index && strcmp(k->key, key) == 0) found = k->block;
  pthread_mutex_unlock(&lock);
  return found;
}

static void keep(const char *key, int64_t index, void *block) {
  kept *k = calloc(1, sizeof *k);
  k->key = strdup(key);
  k->index = index;
  k->block = block;
  pthread_mutex_lock(&lock);
  k->next = keeps;
  keeps = k;
  pthread_mutex_unlock(&lock);
}

static const fishdev_host host = { next_job, request_of, reply_to, listening, state_of, keep };

static void *run(void *self) {
  load *l = self;
  void *lib = dlopen(l->path, RTLD_NOW | RTLD_LOCAL);
  if (lib == NULL) {
    fprintf(stderr, "[fishc] can't load the handlers: %s\n", dlerror());
    if (port < 0) exit(1);
    return NULL;
  }
  void (*attach)(const fishdev_host *, void *) = (void (*)(const fishdev_host *, void *))dlsym(lib, "fishdev_attach");
  int (*entry)(int, char **) = (int (*)(int, char **))dlsym(lib, "main");
  if (attach == NULL || entry == NULL) {
    fprintf(stderr, "[fishc] the handlers at %s have no entry\n", l->path);
    if (port < 0) exit(1);
    return NULL;
  }
  attach(&host, l);
  static char name[] = "fishc-dev";
  static char *argv[] = { name, NULL };
  entry(1, argv);
  if (l->serving) return NULL;
  if (port < 0) {
    fprintf(stderr, "[fishc] the program ended without calling serve\n");
    exit(1);
  }
  fprintf(stderr, "[fishc] the new handlers ended without calling serve; the server keeps the last ones\n");
  return NULL;
}

// The handlers' main runs on a thread of its own, with a main thread's stack.
static void start_load(char *path) {
  load *l = calloc(1, sizeof *l);
  l->path = path;
  pthread_attr_t attrs;
  pthread_attr_init(&attrs);
  pthread_attr_setstacksize(&attrs, 8 << 20);
  pthread_t t;
  pthread_create(&t, &attrs, run, l);
  pthread_detach(t);
  pthread_attr_destroy(&attrs);
}

static char *read_control(void) {
  FILE *f = fopen(control, "r");
  if (f == NULL) return NULL;
  char buffer[4096];
  size_t n = fread(buffer, 1, sizeof buffer - 1, f);
  fclose(f);
  buffer[n] = 0;
  while (n > 0 && buffer[n - 1] == '\n') buffer[--n] = 0;
  return n == 0 ? NULL : strdup(buffer);
}

// fishc dev renames the control file into place, so a read sees one whole path. The host ends
// when fishc dev does, which leaves it to another parent.
static void *watch_control(void *unused) {
  (void)unused;
  pid_t parent = getppid();
  for (;;) {
    usleep(100000);
    if (getppid() != parent) exit(0);
    char *path = read_control();
    if (path == NULL || strcmp(path, loaded) == 0) {
      free(path);
      continue;
    }
    free(loaded);
    loaded = strdup(path);
    start_load(path);
  }
  return NULL;
}

int64_t fishdev_host_start(const char *file) {
  control = strdup(file);
  char *path = read_control();
  if (path == NULL) return 1;
  loaded = strdup(path);
  start_load(path);
  pthread_t t;
  pthread_create(&t, NULL, watch_control, NULL);
  pthread_detach(t);
  return 0;
}

int64_t fishdev_host_port(void) {
  pthread_mutex_lock(&lock);
  while (port < 0) pthread_cond_wait(&moved, &lock);
  int64_t p = port;
  pthread_mutex_unlock(&lock);
  return p;
}

const char *fishdev_host_hostname(void) {
  return hostname;
}

char *fishdev_host_call(const char *request) {
  job *j = calloc(1, sizeof *j);
  j->request = strdup(request);
  pthread_mutex_lock(&lock);
  load *l = current;
  if (l->tail != NULL) l->tail->next = j;
  else l->head = j;
  l->tail = j;
  pthread_cond_broadcast(&moved);
  while (!j->done) pthread_cond_wait(&moved, &lock);
  pthread_mutex_unlock(&lock);
  char *reply = j->reply;
  free(j->request);
  free(j);
  return reply;
}

void fishdev_host_free(char *text) {
  free(text);
}
`;

// The handlers' C half: what std's dev section and codegen call, passed on to the host this load
// was attached to. The n-th state kept under a key in one load is the n-th kept under it in the
// first, so two StateRouters of one type each get their own back.
export const HANDLERS_C = HOST_TABLE + String.raw`
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

typedef struct counted { const char *key; int64_t count; struct counted *next; } counted;

static const fishdev_host *host;
static void *self;
static counted *counts;
static pthread_mutex_t counting = PTHREAD_MUTEX_INITIALIZER;

void fishdev_attach(const fishdev_host *given, void *load) {
  host = given;
  self = load;
}

// How many states this load has asked for under key, this one included when asking.
static int64_t index_of(const char *key, int asking) {
  pthread_mutex_lock(&counting);
  counted *c = counts;
  while (c != NULL && strcmp(c->key, key) != 0) c = c->next;
  if (c == NULL) {
    c = calloc(1, sizeof *c);
    c->key = key;
    c->next = counts;
    counts = c;
  }
  if (asking) c->count++;
  int64_t n = c->count;
  pthread_mutex_unlock(&counting);
  return n;
}

void *fishdev_state(const char *key) {
  return host->state(key, index_of(key, 1));
}

void fishdev_keep(const char *key, void *block) {
  host->keep(key, index_of(key, 0), block);
}

int64_t fishdev_next(void) {
  return host->next(self);
}

const char *fishdev_request(int64_t job) {
  return host->request(job);
}

void fishdev_reply(int64_t job, const uint8_t *bytes, int64_t length) {
  host->reply(job, bytes, length);
}

void fishdev_listen(const char *hostname, int64_t port) {
  host->listen(self, hostname, port);
}
`;

function note(text: string): void {
  console.error(`[fishc] ${text}`);
}

// Points the host at the handlers at `path`, through a file renamed into place.
/** @throws {IoError} */
function publish(control: string, path: string): void {
  writeFileSync(`${control}.next`, path);
  renameSync(`${control}.next`, control);
}

// A server already sent SIGTERM is killed, as is every server on a second signal, so none outlives
// fishc dev.
async function quit(d: Ref<Developing>, s: Ref<Signals>, child: Ref<Subprocess | undefined>, stopping: boolean): Promise<void> {
  const code: i64 = s.interrupt.aborted ? 130 : 143;
  if (child !== undefined) {
    if (stopping) child.kill("SIGKILL");
    const round = new AbortController();
    const ending = round.signal;
    const ended = await Promise.race([stopped(child), signalled(s, 2, ending)]);
    round.abort();
    if (ended.kind === "signal") {
      child.kill("SIGKILL");
      await child.exited;
    }
  }
  d.done();
  process.exit(code);
}

// Builds the host once and the handlers, then serves through the host, building the handlers again
// each time a file they were built from changes and loading them into the running host: its
// listener, connections and kept state stay. A build that fails leaves the last handlers serving;
// one whose state has another shape restarts the host, saying so. Runs until SIGINT or SIGTERM.
/** @throws {IoError} */
export async function develop(d: Developing): Promise<never> {
  const s = listening();
  const control = join(d.dir, "current");
  if (!d.host()) {
    note("the host didn't build");
    d.done();
    process.exit(1);
  }
  const suffix = process.platform === "darwin" ? "dylib" : "so";
  let n = 0;
  let files = watchedFiles([d.entry], d.manifest);
  let contents = snapshot(files);
  let child: Subprocess | undefined = undefined;
  let shapes = "";
  let building = true;
  let because = "";
  let due: i64 | undefined = undefined;
  while (true) {
    if (building) {
      building = false;
      n++;
      // Read before building, so a save during the build still differs afterwards.
      const before = snapshot(files);
      const out = join(d.dir, `handlers-${n}.${suffix}`);
      const made = d.handlers(out);
      let wanted: string[] = made.built ? [] : [...files];
      for (const f of made.loaded) wanted.push(f);
      wanted.push(d.entry);
      files = watchedFiles(wanted, d.manifest);
      let next = new Map<string, string | undefined>();
      for (const f of files) next.set(f, before.has(f) ? before.get(f) : contentsOf(f));
      contents = next;
      if (!made.built) note(child !== undefined ? "the server keeps the handlers that built last; waiting for changes" : "waiting for changes");
      else if (child !== undefined && made.shapes === shapes) {
        publish(control, out);
        note(`reloading: ${because} changed`);
      } else {
        let interrupted = false;
        if (child !== undefined) {
          note("the state's type changed, so the server restarts; its connections and state are dropped");
          const stopping = new AbortController();
          const ending = stopping.signal;
          const ended = await Promise.race([stopped(child), signalled(s, 1, ending)]);
          stopping.abort();
          interrupted = ended.kind === "signal";
        }
        if (interrupted) await quit(d, s, child, true);
        publish(control, out);
        child = Bun.spawn([join(d.dir, "host")], { stdio: ["inherit", "inherit", "inherit"] });
        shapes = made.shapes;
      }
    }
    if (due === undefined && changed(contents) !== undefined) due = Date.now() + SETTLE_MS;
    const round = new AbortController();
    const ending = round.signal;
    const event = await Promise.race([changes(files, s, round), settled(due, s, ending), exited(child, s, ending), signalled(s, 1, ending)]);
    round.abort();
    if (event.kind === "signal") await quit(d, s, child, false);
    if (event.kind === "change") due = Date.now() + SETTLE_MS;
    if (event.kind === "exited") {
      note(`the server exited with code ${event.code}; waiting for changes`);
      child = undefined;
    }
    if (event.kind !== "settled") continue;
    due = undefined;
    const file = changed(contents);
    if (file === undefined) continue;
    because = shown(file);
    building = true;
  }
}
