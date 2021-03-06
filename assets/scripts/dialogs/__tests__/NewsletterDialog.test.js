/* eslint-env jest */
import React from 'react'
import { renderWithReduxAndIntl } from '../../../../test/helpers/render'
import NewsletterDialog from '../NewsletterDialog'

// Mock Mailchimp HTML snippet
jest.mock('../Newsletter/mailchimp.html', () => '<div>foo</div>')

describe('NewsletterDialog', () => {
  it('renders snapshot', () => {
    const wrapper = renderWithReduxAndIntl(<NewsletterDialog />)
    expect(wrapper.asFragment()).toMatchSnapshot()
  })
})
