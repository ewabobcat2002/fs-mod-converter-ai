import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'fs-mod-converter-nvh21fo8',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_guhh9dkUrAlO4Ca1g_p97gjvbsD9xk1z',
  authRequired: false,
  auth: { mode: 'managed' },
})
