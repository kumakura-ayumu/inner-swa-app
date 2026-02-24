// @ts-check
'use strict'

const { app } = require('@azure/functions')

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => {
    return { status: 200, body: 'OK' }
  },
})
