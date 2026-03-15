import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import App from './App'
import { isProtectedAddonsPermissionError } from './features/launcher/domain/launcherLogic'
import { __resetDemoApiState, api } from './lib/api'

beforeEach(() => {
  __resetDemoApiState('update-available-pack')
})

test('auto-completes first launch when one path is detected', async () => {
  __resetDemoApiState('single-setup')
  render(<App />)
  expect(await screen.findByText(/Install Pack/i)).toBeInTheDocument()
})

test('asks the user to select an install when multiple paths are detected', async () => {
  __resetDemoApiState('multiple-setup')
  render(<App />)
  expect(await screen.findByText(/Select an install/i)).toBeInTheDocument()
})

test('shows manual setup when no paths are detected', async () => {
  __resetDemoApiState('manual-setup')
  render(<App />)
  expect(await screen.findByText(/Open Settings/i)).toBeInTheDocument()
})

test('shows install pack on a clean configured machine', async () => {
  __resetDemoApiState('installable-pack')
  render(<App />)
  expect(await screen.findByRole('button', { name: /Install Pack/i })).toBeInTheDocument()
})

test('shows up to date state for an installed pack', async () => {
  __resetDemoApiState('up-to-date-pack')
  render(<App />)
  expect(await screen.findByText(/Up To Date/i)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Resync Pack/i })).toBeInTheDocument()
})

test('shows update available state for an outdated pack', async () => {
  __resetDemoApiState('update-available-pack')
  render(<App />)
  expect(await screen.findByText(/Update Available/i)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Sync Pack Updates/i })).toBeInTheDocument()
})

test('shows recovery needed when an interrupted operation exists', async () => {
  __resetDemoApiState('recovery-needed')
  render(<App />)
  expect(await screen.findByText(/Recovery Needed/i)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Open Recovery/i })).toBeInTheDocument()
})

test('maintainer mode hides and reveals advanced screens', async () => {
  const user = userEvent.setup()
  render(<App />)

  expect(screen.queryByRole('button', { name: /^Addons$/i })).not.toBeInTheDocument()

  await user.click(await screen.findByRole('button', { name: /^Settings$/i }))
  await user.click(await screen.findByRole('button', { name: /Enable Maintainer Mode/i }))

  expect(await screen.findByRole('button', { name: /^Addons$/i })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /^Profiles$/i })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /^Developer$/i })).toBeInTheDocument()
})

test('detects protected AddOns permission guidance', () => {
  expect(
    isProtectedAddonsPermissionError(
      "Sync failed: Cannot write to AddOns folder at 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns': Windows denied access to a protected install location. If Ascension is installed under Program Files, run BronzeForge as Administrator or move the game to a user-writable folder. If the game or launcher is open, close them and try again.",
    ),
  ).toBe(true)
  expect(isProtectedAddonsPermissionError('Sync failed: permission denied.')).toBe(false)
})

// ---------------------------------------------------------------------------
// Interaction: clicking primary CTA transitions state
// ---------------------------------------------------------------------------

test('clicking Sync Pack Updates transitions UI to Up To Date', async () => {
  const user = userEvent.setup()
  render(<App />)

  // Wait for initial state to load — update available
  const syncBtn = await screen.findByRole('button', { name: /Sync Pack Updates/i })
  await user.click(syncBtn)

  // After sync the pack should report Up To Date and the CTA switches to Resync Pack
  expect(await screen.findByText(/Up To Date/i)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Resync Pack/i })).toBeInTheDocument()
})

test('clicking Open Recovery navigates to the recovery screen', async () => {
  __resetDemoApiState('recovery-needed')
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('button', { name: /Open Recovery/i }))

  // Recovery screen has a Preview Restore button — confirms navigation occurred
  expect(await screen.findByRole('button', { name: /Preview Restore/i })).toBeInTheDocument()
})

test('preview restore flow shows items and applies on confirm', async () => {
  __resetDemoApiState('recovery-needed')
  const user = userEvent.setup()
  render(<App />)

  // Navigate to recovery screen
  await user.click(await screen.findByRole('button', { name: /Recovery/i }))

  // Trigger preview
  await user.click(await screen.findByRole('button', { name: /Preview Restore/i }))

  // Preview panel should appear with at least one addon item
  expect(await screen.findByText(/Restore Preview/i)).toBeInTheDocument()

  // Apply the restore
  await user.click(await screen.findByRole('button', { name: /Restore Last Known Good/i }))

  // After apply the notice banner confirms success
  expect(await screen.findByText(/Recovered pack snapshot/i)).toBeInTheDocument()
})

test('sync failure shows an error banner', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'syncCuratedPack').mockRejectedValueOnce(new Error('Network timeout'))
  render(<App />)

  await user.click(await screen.findByRole('button', { name: /Sync Pack Updates/i }))

  expect(await screen.findByText(/Sync failed: Network timeout/i)).toBeInTheDocument()
  vi.restoreAllMocks()
})

test('multiple-setup shows error when Complete Setup clicked without selecting a candidate', async () => {
  __resetDemoApiState('multiple-setup')
  const user = userEvent.setup()
  render(<App />)

  // The "Complete Setup" button is the primary CTA here
  await user.click(await screen.findByRole('button', { name: /Complete Setup/i }))

  expect(await screen.findByText(/Select an install before continuing setup/i)).toBeInTheDocument()
})
