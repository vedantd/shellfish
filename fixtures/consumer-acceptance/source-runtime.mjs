import { registerHooks, createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Read the checkout's current TS source, without rebuilding or changing that checkout. */
export async function loadSourceRuntime(repository) {
  const repo = resolve(repository);
  const require = createRequire(pathToFileURL(resolve(repo, 'package.json')));
  const ts = require('typescript');
  const workspace = new Set(['schemas', 'registry', 'evidence', 'compatibility', 'authorization', 'xrpl']);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const name = specifier.startsWith('@shellfish/') ? specifier.slice(11) : '';
      if (workspace.has(name)) return { url: pathToFileURL(resolve(repo, 'packages', name, 'src/index.ts')).href, shortCircuit: true };
      try { return nextResolve(specifier, context); }
      catch (error) {
        if (context.parentURL?.startsWith('file:') && specifier.endsWith('.js') && (specifier.startsWith('.') || isAbsolute(specifier))) {
          const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier).replace(/\.js$/, '.ts');
          if (candidate.startsWith(`${repo}/`) && existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (url.startsWith(pathToFileURL(`${repo}/`).href) && url.endsWith('.ts')) {
        const result = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
          fileName: fileURLToPath(url),
        });
        return { format: 'module', source: result.outputText, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  const imported = {};
  for (const name of ['schemas', 'registry', 'authorization', 'xrpl']) {
    imported[name] = await import(pathToFileURL(resolve(repo, 'packages', name, 'src/index.ts')).href);
  }
  imported.Database = createRequire(pathToFileURL(resolve(repo, 'services/api/package.json')))('better-sqlite3');
  return { ...imported, repo, hooks };
}
