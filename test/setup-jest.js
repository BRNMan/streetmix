/* eslint-env jest */
import '@testing-library/jest-dom/extend-expect'
import fetch from 'jest-fetch-mock'
import 'jest-canvas-mock'
import 'jest-date-mock'
import LocalStorageMock from './__mocks__/LocalStorageMock'

// Add mocks for global methods
global.fetch = fetch
global.localStorage = new LocalStorageMock()

// Add stubs for global methods
global.print = jest.fn()
global.confirm = jest.fn(() => true)

// Add HTML methods not implemented in jsdom
// https://github.com/jsdom/jsdom/issues/1695
global.HTMLElement.prototype.scrollIntoView = jest.fn()
