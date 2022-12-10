/**
 * @param {import('@ucanto/interface').Principal} [servicePrincipal]
 * @param {URL} [serviceURL]
 */
export function createEnv (servicePrincipal, serviceURL) {
  const env = { W3_STORE_NAME: 'w3cli-test' }
  if (servicePrincipal && serviceURL) {
    Object.assign(env, {
      W3_ACCESS_SERVICE_DID: servicePrincipal.did(),
      W3_ACCESS_SERVICE_URL: serviceURL.toString(),
      W3_UPLOAD_SERVICE_DID: servicePrincipal.did(),
      W3_UPLOAD_SERVICE_URL: serviceURL.toString()
    })
  }
  return env
}
