import { registerHooks } from 'node:module';

// The app imports TypeScript modules without extensions, as Vite allows; node needs the `.ts` spelled out.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});
