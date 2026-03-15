import { DemoLauncherGateway } from './demoLauncherGateway'
import { TauriLauncherGateway } from './tauriLauncherGateway'
import type { LauncherGateway } from './launcherGateway'

export type { LauncherGateway } from './launcherGateway'
export { TauriLauncherGateway } from './tauriLauncherGateway'
export { DemoLauncherGateway } from './demoLauncherGateway'
export type { DemoScenario } from './demoLauncherGateway'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Lazy: only created when actually needed. In production Tauri builds
// neither the ternary below nor __resetDemoApiState is ever evaluated with
// isTauri = true, so the demo store is never allocated.
let _demoGateway: DemoLauncherGateway | undefined
function getDemoGateway(): DemoLauncherGateway {
  return (_demoGateway ??= new DemoLauncherGateway())
}

export const api: LauncherGateway = isTauri ? new TauriLauncherGateway() : getDemoGateway()

export function __resetDemoApiState(scenario?: Parameters<DemoLauncherGateway['resetScenario']>[0]): void {
  getDemoGateway().resetScenario(scenario)
}
