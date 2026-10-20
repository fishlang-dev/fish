// mode: parse
function f() {
  switch (command) {
    case "start":
    case "resume":
      run()
      break
    case "stop": {
      halt()
      return
    }
    default:
      unknown()
  }
  outer: for (const row of rows) {
    inner: for (const cell of row) {
      if (cell) continue outer
      if (!cell) break inner
    }
  }
  try {
    risky()
  } catch (error: unknown) {
    report(error)
  } finally {
    cleanup()
  }
  try { a() } catch { b() }
  try { a() } catch ({ message, code = 0 }) { log(message) }
  throw new Error(`failed: ${reason}`)
}
