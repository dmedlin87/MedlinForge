import { DemoLauncherGateway } from './demoLauncherGateway'
import { TauriLauncherGateway } from './tauriLauncherGateway'
import type { LauncherGateway } from './launcherGateway'

export type { LauncherGateway } from './launcherGateway'
export { TauriLauncherGateway } from './tauriLauncherGateway'
export { DemoLauncherGateway } from './demoLauncherGateway'
export type { DemoScenario } from './demoLauncherGateway'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const demoGateway = new DemoLauncherGateway()

export const api: LauncherGateway = isTauri ? new TauriLauncherGateway() : demoGateway

export function __resetDemoApiState(scenario?: Parameters<DemoLauncherGateway['resetScenario']>[0]): void {
  demoGateway.resetScenario(scenario)
}
