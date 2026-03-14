import { render, screen } from '@testing-library/react'

import App from './App'

test('renders the BronzeForge shell', async () => {
  render(<App />)
  expect(await screen.findByText(/BronzeForge control center/i)).toBeInTheDocument()
  expect(await screen.findByText(/Managed addons/i)).toBeInTheDocument()
})
