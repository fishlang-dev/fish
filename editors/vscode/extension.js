const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');

let client;

function fishc() {
  return vscode.workspace.getConfiguration('fsh').get('fishc.path') || 'fishc';
}

// The directory holding the fish.toml nearest above `file`, where `fishc test` runs.
function packageDir(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'fish.toml'))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

// A fishc task on `file`; a `test` task runs the tests of `file`'s package whose names contain
// `test`, from the package's directory.
function task(command, file, folder, test) {
  const definition = test === undefined ? { type: 'fishc', command, file } : { type: 'fishc', command, file, test };
  const args = command === 'test' ? ['test', test ?? ''] : [command, file];
  const cwd = command === 'test' ? packageDir(file) ?? folder.uri.fsPath : folder.uri.fsPath;
  const execution = new vscode.ProcessExecution(fishc(), args, { cwd });
  const label = command === 'test' ? `test ${test ?? ''}` : `${command} ${vscode.workspace.asRelativePath(file)}`;
  const t = new vscode.Task(definition, folder, label, 'fishc', execution, '$fishc');
  if (command === 'build') t.group = vscode.TaskGroup.Build;
  return t;
}

// A build, run and check task for the open .fsh file, and any task.json entry of type `fishc`.
const tasks = {
  provideTasks() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'fsh') return [];
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) return [];
    return ['build', 'run', 'check'].map((command) => task(command, editor.document.uri.fsPath, folder));
  },
  resolveTask(t) {
    const { command, file, test } = t.definition;
    if (!command || !file || typeof t.scope !== 'object') return undefined;
    return task(command, file, t.scope, test);
  },
};

// What the server's code lenses run: `fishc run` on a file, and `fishc test <name>` in its package.
// The test filter matches names containing it, as `fishc test` does.
function lensCommands() {
  return [
    vscode.commands.registerCommand('fsh.run', (file) => {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
      if (folder) vscode.tasks.executeTask(task('run', file, folder));
    }),
    vscode.commands.registerCommand('fsh.runTest', (file, name) => {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
      if (!packageDir(file) || !folder) {
        vscode.window.showErrorMessage(`No fish.toml above ${file}; tests run inside a package.`);
        return;
      }
      vscode.tasks.executeTask(task('test', file, folder, name));
    }),
  ];
}

function activate(context) {
  context.subscriptions.push(vscode.tasks.registerTaskProvider('fishc', tasks), ...lensCommands());
  client = new LanguageClient(
    'fsh',
    'Fish Lang',
    { command: fishc(), args: ['lsp'] },
    { documentSelector: [{ language: 'fsh' }] },
  );
  return client.start();
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
