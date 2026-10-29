import { access } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const parentDirectory = dirname(fileURLToPath(context.parentURL))
    const unresolved = resolvePath(parentDirectory, specifier)
    for (const extension of ['.ts', '.js', '.mjs']) {
      try {
        await access(`${unresolved}${extension}`)
        return nextResolve(pathToFileURL(`${unresolved}${extension}`).href, context)
      } catch {
        // Continue through the extensions Vite normally resolves.
      }
    }
  }
  return nextResolve(specifier, context)
}
