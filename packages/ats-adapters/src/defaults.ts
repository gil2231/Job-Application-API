import type { Page } from "playwright-core";
import type { Platform } from "@autoapply/shared";
import { GenericWebFormAdapter } from "./generic/generic-adapter";
import { AshbyAdapter } from "./platforms/ashby";
import { GreenhouseAdapter } from "./platforms/greenhouse";
import { LeverAdapter } from "./platforms/lever";
import { SmartRecruitersAdapter } from "./platforms/smartrecruiters";
import { WorkdayAdapter } from "./platforms/workday";
import { AdapterRegistry } from "./registry";

/** Platforms the bundled adapters fill. LinkedIn Easy Apply is deliberately not one of them. */
export const AUTOMATED_PLATFORMS: readonly Platform[] = ["WORKDAY", "GREENHOUSE", "LEVER", "ASHBY", "SMARTRECRUITERS", "GENERIC"];

/** Every bundled adapter. Adding an ATS is one more register() call here. */
export function createDefaultRegistry(): AdapterRegistry<Page> {
  return new AdapterRegistry<Page>()
    .register(new WorkdayAdapter())
    .register(new GreenhouseAdapter())
    .register(new LeverAdapter())
    .register(new AshbyAdapter())
    .register(new SmartRecruitersAdapter())
    .register(new GenericWebFormAdapter());
}
