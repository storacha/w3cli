/**
 * @param {object} [options]
 * @param {import('@ucanto/interface').Principal} [options.servicePrincipal]
 * @param {URL} [options.serviceURL]
 * @param {string} [options.storeName]
 */
export function createEnv (options = {}) {
  const { servicePrincipal, serviceURL, storeName } = options
  const env = { W3_STORE_NAME: storeName ?? 'w3cli-test' }
  if (servicePrincipal && serviceURL) {
    Object.assign(env, {
      W3UP_SERVICE_DID: servicePrincipal.did(),
      W3UP_SERVICE_URL: serviceURL.toString()
    })
  }
  return env
}
