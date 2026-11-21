export {
  createInteract,
  InteractViewport,
  type CreateInteractOptions,
  type DrillCrumb,
  type TransformCommitPayload,
  type TransformMode,
} from "./createInteract";

// Propagate createInteract HMR to hosts that accept `@/interact`.
if (import.meta.hot) {
  import.meta.hot.accept("./createInteract", () => {
    import.meta.hot?.invalidate();
  });
}
