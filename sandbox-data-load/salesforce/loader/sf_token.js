// Prints {accessToken, instanceUrl, orgId, username} for an sf CLI alias as JSON on stdout.
// `sf org display` redacts the token, so this reads it through @salesforce/core, the library
// the CLI itself uses (NODE_PATH points at the CLI's node_modules). Nothing is written to disk.
const { AuthInfo, Connection, StateAggregator } = require('@salesforce/core');

(async () => {
  const alias = process.argv[2];
  const state = await StateAggregator.getInstance();
  const username = state.aliases.resolveUsername(alias) || alias;
  const authInfo = await AuthInfo.create({ username });
  const conn = await Connection.create({ authInfo });
  await conn.refreshAuth();  // a fresh token, valid for the session timeout
  const fields = authInfo.getFields(true);
  process.stdout.write(JSON.stringify({
    accessToken: conn.accessToken,
    instanceUrl: conn.instanceUrl,
    orgId: fields.orgId,
    username,
  }));
})().catch((e) => {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
