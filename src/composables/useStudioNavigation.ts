import { inject } from "vue";
import {
  STUDIO_NAVIGATION_KEY,
  getStudioNavigation,
} from "@/repos/runtime";
import type { StudioNavigation } from "@/repos/types";

/** Prefer Vue inject when provided; fall back to module runtime. */
export function useStudioNavigation(): StudioNavigation {
  return inject(STUDIO_NAVIGATION_KEY, null) ?? getStudioNavigation();
}
