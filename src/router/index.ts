import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "browse",
      component: () => import("@/views/BrowseView.vue"),
    },
    {
      path: "/edit/:id",
      name: "edit",
      component: () => import("@/views/EditView.vue"),
      props: true,
    },
  ],
});
