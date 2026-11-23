import { createApp } from "vue";
import { createPinia } from "pinia";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import App from "./App.vue";
import { installStudio } from "./lib/installStudio";
import { router } from "./router";
import { initTheme } from "./theme";
import "./styles/global.css";

initTheme();

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
installStudio(app, {
  navigation: {
    goBrowse: () => {
      void router.push({ name: "browse" });
    },
    goEdit: (id) => {
      void router.push({ name: "edit", params: { id } });
    },
  },
});
app.use(TDesign);
app.mount("#app");
