// @ts-check
'use strict'

const { app } = require('@azure/functions')

/**
 * SWA の x-ms-client-principal ヘッダーをデコードする。
 * ヘッダーは以下構造の JSON を base64 エンコードしたもの:
 * {
 *   "identityProvider": "aad",
 *   "userId": "abc123",
 *   "userDetails": "user@example.com",
 *   "userRoles": ["authenticated"],
 *   "claims": [
 *     { "typ": "http://schemas.microsoft.com/identity/claims/tenantid", "val": "xxx" },
 *     ...
 *   ]
 * }
 * @param {string} headerValue
 * @returns {{ identityProvider: string, userId: string, userDetails: string, userRoles: string[], claims: Array<{ typ: string, val: string }> } | null}
 */
function decodeClientPrincipal(headerValue) {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

app.http('saveDuty', {
  methods: ['POST'],
  // SWA がエッジで認証を担保するため authLevel は anonymous。
  // 関数自身も principal ヘッダーを検証することで多層防御を実現する。
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('saveDuty: 呼び出し開始')
    try {

    // ── セキュリティチェック 1: principal ヘッダーの存在確認 ──
    const principalHeader = request.headers.get('x-ms-client-principal')
    if (!principalHeader) {
      context.warn('saveDuty: x-ms-client-principal ヘッダーが見つかりません')
      return {
        status: 401,
        jsonBody: { error: 'Unauthorized: No client principal found' },
      }
    }

    // ── セキュリティチェック 2: base64デコード & JSON解析 ──
    const principal = decodeClientPrincipal(principalHeader)
    if (!principal) {
      context.warn('saveDuty: principal のデコードに失敗しました')
      return {
        status: 401,
        jsonBody: { error: 'Unauthorized: Failed to decode client principal' },
      }
    }

    // ── セキュリティチェック 3: AAD 認証であることを確認 ──
    // SWA Easy Auth は claims を渡さないため identityProvider で確認する。
    // SWA 自体が AAD 認証を強制しているため多層防御として機能する。
    if (principal.identityProvider !== 'aad') {
      context.warn(
        `saveDuty: 許可されていない identityProvider: ${principal.identityProvider}`,
      )
      return {
        status: 403,
        jsonBody: { error: 'Forbidden: AAD authentication required' },
      }
    }

    // ── リクエストボディの解析 ──
    /** @type {{ duties?: Array<{ id: string, day: string, member: string }> }} */
    let body
    try {
      body = await request.json()
    } catch {
      return {
        status: 400,
        jsonBody: { error: 'Bad Request: Invalid JSON body' },
      }
    }

    const { duties } = body
    if (!Array.isArray(duties) || duties.length === 0) {
      return {
        status: 400,
        jsonBody: { error: 'Bad Request: duties must be a non-empty array' },
      }
    }

    for (const duty of duties) {
      if (
        typeof duty.id !== 'string' ||
        typeof duty.day !== 'string' ||
        typeof duty.member !== 'string'
      ) {
        return {
          status: 400,
          jsonBody: {
            error: 'Bad Request: each duty must have id, day, member as strings',
          },
        }
      }
    }

    // ── Power Automate へ転送 ──
    const powerAutomateUrl = process.env.POWER_AUTOMATE_URL
    if (!powerAutomateUrl) {
      context.error('saveDuty: POWER_AUTOMATE_URL 環境変数が未設定です')
      return {
        status: 500,
        jsonBody: { error: 'Server configuration error: POWER_AUTOMATE_URL not set' },
      }
    }

    const payload = {
      duties,
      savedBy: principal.userDetails || principal.userId || 'unknown',
      savedAt: new Date().toISOString(),
    }

    context.log('saveDuty: Power Automate へ転送します:', JSON.stringify(payload))

    try {
      // Node 18+ では fetch がグローバルに利用可能
      const paResponse = await fetch(powerAutomateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!paResponse.ok) {
        const paBody = await paResponse.text()
        context.error(
          `saveDuty: Power Automate が ${paResponse.status} を返しました: ${paBody}`,
        )
        return {
          status: 502,
          jsonBody: { error: 'Failed to forward to Power Automate' },
        }
      }

      context.log(`saveDuty: Power Automate 応答 ${paResponse.status} OK`)
      return {
        status: 200,
        jsonBody: { success: true, savedAt: payload.savedAt },
      }
    } catch (err) {
      context.error('saveDuty: Power Automate 呼び出しでネットワークエラー:', err)
      return {
        status: 502,
        jsonBody: { error: 'Network error calling Power Automate' },
      }
    }

    } catch (outerErr) {
      // 想定外の例外を握りつぶさず 500 で返す（空レスポンスを防ぐ）
      context.error('saveDuty: 予期しないエラー:', outerErr)
      return {
        status: 500,
        jsonBody: { error: 'Internal server error' },
      }
    }
  },
})
