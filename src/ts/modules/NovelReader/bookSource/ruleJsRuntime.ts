/* eslint-disable no-new-func */
import {parse, Node} from 'acorn';

interface Statement extends Node {
  body?: Statement | Statement[];
  expression?: Node;
  test?: Node;
  consequent?: Statement;
  alternate?: Statement;
  init?: Node;
  update?: Node;
  left?: Node;
  right?: Node;
  label?: {name: string};
  cases?: {test: Node | null; consequent: Statement[]}[];
  block?: Statement;
  handler?: {param: Node | null; body: Statement};
  finalizer?: Statement;
}

type RuleFunction = (...values: unknown[]) => unknown;
const libraries = new Map<string, string>();
const compiled = new Map<string, RuleFunction>();
const remember = <T>(cache: Map<string, T>, key: string, value: T) => {
  if (cache.size >= 64) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, value);
  return value;
};

/** 将常见 Packer 脚本库展开为同一函数作用域，避开 Hermes 的全局 eval 语义。 */
const expandLibrary = (library: string): string => {
  const cached = libraries.get(library);
  if (cached !== undefined) {
    return cached;
  }
  let expanded = library;
  for (let round = 0; round < 4; round += 1) {
    const program = parse(expanded, {ecmaVersion: 'latest'}) as unknown as {
      body: Statement[];
    };
    let changed = false;
    for (const statement of [...program.body].reverse()) {
      const call = statement.expression as
        | (Node & {
            callee?: {type: string; name?: string};
            arguments?: (Node & {
              type: string;
              value?: unknown;
              callee?: {type: string; params?: {name?: string}[]};
            })[];
          })
        | undefined;
      if (call?.type !== 'CallExpression' || call.callee?.name !== 'eval') {
        continue;
      }
      const argument = call.arguments?.[0];
      const packer =
        argument?.type === 'CallExpression' &&
        argument.callee?.type === 'FunctionExpression' &&
        argument.callee.params?.map(param => param.name).join(',') ===
          'p,a,c,k,e,r';
      if (!argument || (!packer && typeof argument.value !== 'string')) {
        throw new Error('书源脚本库包含当前不支持的动态 eval');
      }
      // Packer 参数是自包含的压缩文本；只展开文本，不执行其产生的库代码。
      const decoded: unknown = packer
        ? new Function(
            'return (' + expanded.slice(argument.start, argument.end) + ');',
          )()
        : argument.value;
      if (typeof decoded !== 'string') {
        throw new Error('书源脚本库展开结果不是文本');
      }
      expanded =
        expanded.slice(0, statement.start) +
        decoded +
        ';' +
        expanded.slice(statement.end);
      changed = true;
    }
    if (!changed) {
      return remember(libraries, library, expanded);
    }
  }
  throw new Error('书源脚本库嵌套过深');
};

/** 为语句记录完成值，函数体保持原样；无需 eval，适用于 Hermes。 */
const compileScript = (
  script: string,
  library: string,
  keys: string[],
): RuleFunction => {
  const cacheKey = library + '\n' + script + '\n' + keys.join(',');
  const cached = compiled.get(cacheKey);
  if (cached) {
    return cached;
  }
  const program = parse(script, {
    ecmaVersion: 'latest',
    allowReturnOutsideFunction: true,
  }) as unknown as {body: Statement[]};
  let name = '__bookSourceCompletion';
  while ((script + library).includes(name)) {
    name += '_';
  }
  const cut = (node?: Node | null) =>
    node ? script.slice(node.start, node.end) : '';
  const block = (node: Statement) => render(node);
  const render = (node: Statement, label = ''): string => {
    const body = () => block(node.body as Statement);
    switch (node.type) {
      case 'ExpressionStatement':
        return name + ' = (' + cut(node.expression) + ');';
      case 'BlockStatement':
        return (
          label +
          '{' +
          (node.body as Statement[]).map(item => render(item)).join('\n') +
          '}'
        );
      case 'IfStatement':
        return (
          label +
          '{' +
          name +
          '=undefined; if(' +
          cut(node.test) +
          ')' +
          block(node.consequent!) +
          (node.alternate ? 'else ' + block(node.alternate) : '') +
          '}'
        );
      case 'WhileStatement':
        return (
          '{' +
          name +
          '=undefined;' +
          label +
          'while(' +
          cut(node.test) +
          ')' +
          body() +
          '}'
        );
      case 'DoWhileStatement':
        return (
          '{' +
          name +
          '=undefined;' +
          label +
          'do ' +
          body() +
          ' while(' +
          cut(node.test) +
          '); }'
        );
      case 'ForStatement':
        return (
          '{' +
          name +
          '=undefined;' +
          label +
          'for(' +
          cut(node.init) +
          ';' +
          cut(node.test) +
          ';' +
          cut(node.update) +
          ')' +
          body() +
          '}'
        );
      case 'ForInStatement':
      case 'ForOfStatement':
        return (
          '{' +
          name +
          '=undefined;' +
          label +
          'for(' +
          cut(node.left) +
          (node.type === 'ForInStatement' ? ' in ' : ' of ') +
          cut(node.right) +
          ')' +
          body() +
          '}'
        );
      case 'LabeledStatement':
        return render(node.body as Statement, node.label!.name + ':');
      case 'SwitchStatement':
        return (
          '{' +
          name +
          '=undefined;' +
          label +
          'switch(' +
          cut((node as Statement & {discriminant: Node}).discriminant) +
          '){' +
          node
            .cases!.map(
              item =>
                (item.test ? 'case ' + cut(item.test) : 'default') +
                ':' +
                item.consequent.map(child => render(child)).join('\n'),
            )
            .join('\n') +
          '}}'
        );
      case 'TryStatement':
        return (
          '{' +
          name +
          '=undefined;try ' +
          block(node.block!) +
          (node.handler
            ? 'catch' +
              (node.handler.param ? '(' + cut(node.handler.param) + ')' : '') +
              block(node.handler.body)
            : '') +
          (node.finalizer
            ? 'finally { const ' +
              name +
              '_saved = ' +
              name +
              '; try ' +
              block(node.finalizer) +
              ' finally { ' +
              name +
              ' = ' +
              name +
              '_saved; }}'
            : '') +
          '}'
        );
      default:
        return label + cut(node);
    }
  };
  const code =
    expandLibrary(library) +
    '\nlet ' +
    name +
    ';\n' +
    program.body.map(node => render(node)).join('\n') +
    '\nreturn ' +
    name +
    ' !== undefined ? ' +
    name +
    ' : (typeof content !== "undefined" ? content : (typeof text !== "undefined" ? text : result));';
  return remember(
    compiled,
    cacheKey,
    new Function('result', ...keys, code) as RuleFunction,
  );
};

/** 宿主绑定只存在于同步脚本执行期间；成功、异常和请求重放都会恢复原值。 */
export const executeRuleScript = (
  script: string,
  library: string,
  result: unknown,
  bindings: Record<string, unknown>,
): unknown => {
  const runtime = {...bindings};
  const keys = Object.keys(runtime);
  const fn = compileScript(script, library, keys);
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  try {
    keys.forEach(key => {
      previous.set(key, Object.getOwnPropertyDescriptor(host, key));
      Object.defineProperty(host, key, {
        value: runtime[key],
        configurable: true,
        writable: true,
      });
    });
    return fn.call(runtime, result, ...keys.map(key => runtime[key]));
  } finally {
    previous.forEach((descriptor, key) => {
      if (descriptor) {
        Object.defineProperty(host, key, descriptor);
      } else {
        delete host[key];
      }
    });
  }
};
