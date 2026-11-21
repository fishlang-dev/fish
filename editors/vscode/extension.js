const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');

let client;

function fishc() {
  return vscode.workspace.getConfiguration('fsh').get('fishc.path') || 'fishc';
}

function task(command, file, folder) {
  const definition = { type: 'fishc', command, file };
  const execution = new vscode.ProcessExecution(fishc(), [command, file], { cwd: folder.uri.fsPath });
  const t = new vscode.Task(definition, folder, `${command} ${vscode.workspace.asRelativePath(file)}`, 'fishc', execution, '$fishc');
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
    const { command, file } = t.definition;
    if (!command || !file || typeof t.scope !== 'object') return undefined;
    return task(command, file, t.scope);
  },
};

function activate(context) {
  context.subscriptions.push(vscode.tasks.registerTaskProvider('fishc', tasks));
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
