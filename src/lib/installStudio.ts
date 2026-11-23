import type { App, Plugin } from "vue";
import { provideStudioRuntime } from "@/repos/runtime";
import type { InstallStudioOptions } from "@/repos/types";

export type { InstallStudioOptions };

/**
 * Install Studio runtime on a Vue app: document/asset repositories + navigation.
 * Call after `app.use(createPinia())`. Hosts supply custom repos for DB/FTP/etc.
 */
export function installStudio(
  app: App,
  options: InstallStudioOptions = {}
): App {
  provideStudioRuntime(app, options);
  return app;
}

/** Vue plugin form: `app.use(studioPlugin, options)`. */
export const studioPlugin: Plugin<InstallStudioOptions> = {
  install(app, options = {}) {
    installStudio(app, options);
  },
};
