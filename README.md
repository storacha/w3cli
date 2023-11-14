<h1 align="center">⁂<br/>web3.storage</h1>
<h3 align="center">💾 w3 command line interface.</h3>
<p align="center">
  <a href="https://github.com/web3-storage/w3cli/actions/workflows/test.yml"><img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/web3-storage/w3cli/test.yml?branch=main&style=for-the-badge" /></a>
  <a href="https://discord.com/channels/806902334369824788/864892166470893588"><img src="https://img.shields.io/badge/chat-discord?style=for-the-badge&logo=discord&label=discord&logoColor=ffffff&color=7389D8" /></a>
  <a href="https://github.com/web3-storage/w3cli/blob/main/LICENSE.md"><img alt="License: Apache-2.0 OR MIT" src="https://img.shields.io/badge/LICENSE-Apache--2.0%20OR%20MIT-yellow?style=for-the-badge" /></a>
</p>

## Getting started 

Install the CLI from npm (**`w3up-client` requires Node 18 or higher**):

```console
npm install -g @web3-storage/w3cli
```

Authorize this agent to act on behalf of the account associated with your email address:

```console
w3 authorize alice@example.com
```

Create a new Space for storing your data and register it:

```console
w3 space create Documents # pick a good name!
w3 space register # defaults to registering you with web3.storage
```

If you'd like to learn more about what is going on under the hood with w3up and its use of Spaces, [UCANs](https://ucan.xyz/), and more, check out the `w3up-client` README [here](https://github.com/web3-storage/w3up/tree/main/packages/w3up-client#usage).

> By registering your w3up beta Space with [web3.storage](http://web3.storage/), you agree to the w3up beta [Terms of Service](https://console.web3.storage/terms). Until the beta period is over and this migration occurs, uploads to w3up will not appear in your web3.storage account (and vice versa), even if you register with the same email.

Upload a file or directory:

```console
w3 up recipies.txt
```
> ⚠️❗ __Public Data__ 🌎: All data uploaded to w3up is available to anyone who requests it using the correct CID. Do not store any private or sensitive information in an unencrypted form using w3up.

> ⚠️❗ __Permanent Data__ ♾️: Removing files from w3up will remove them from the file listing for your account, but that doesn’t prevent nodes on the decentralized storage network from retaining copies of the data indefinitely. Do not use w3up for data that may need to be permanently deleted in the future.

## Commands

* Basics
  * [`w3 login`](#w3-login-email)
  * [`w3 up`](#w3-up-path-path)
  * [`w3 ls`](#w3-ls)
  * [`w3 rm`](#w3-rm-root-cid)
  * [`w3 open`](#w3-open-cid)
  * [`w3 whoami`](#w3-whoami)
* Space management
  * [`w3 space add`](#w3-space-add-proofucan)
  * [`w3 space create`](#w3-space-create-name)
  * [`w3 space ls`](#w3-space-ls)
  * [`w3 space register`](#w3-space-register)
  * [`w3 space use`](#w3-space-use-did)
  * [`w3 space info`](#w3-space-info)
* Capability management
  * [`w3 delegation create`](#w3-delegation-create-audience-did)
  * [`w3 delegation ls`](#w3-delegation-ls)
  * [`w3 delegation revoke`](#w3-delegation-revoke-delegation-cid)
  * [`w3 proof add`](#w3-proof-add-proofucan)
  * [`w3 proof ls`](#w3-proof-ls)
* Advanced usage
  * [`w3 can space info`](#w3-can-space-info-did) <sup>coming soon!</sup>
  * [`w3 can space recover`](#w3-can-space-recover-email) <sup>coming soon!</sup>
  * [`w3 can store add`](#w3-can-store-add-car-path)
  * [`w3 can store ls`](#w3-can-store-ls)
  * [`w3 can store rm`](#w3-can-store-rm-car-cid)
  * [`w3 can upload add`](#w3-can-upload-add-root-cid-shard-cid-shard-cid)
  * [`w3 can upload ls`](#w3-can-upload-ls)
  * [`w3 can upload rm`](#w3-can-upload-rm-root-cid)

---

### `w3 login <email>`

Authenticate this agent with your email address to get access to all capabilities that had been delegated to it.

### `w3 up <path> [path...]`

Upload file(s) to web3.storage. The IPFS Content ID (CID) for your files is calculated on your machine, and sent up along with your files. web3.storage makes your content available on the IPFS network

* `--no-wrap` Don't wrap input files with a directory.
* `-H, --hidden` Include paths that start with ".".
* `-c, --car` File is a CAR file.
* `--shard-size` Shard uploads into CAR files of approximately this size in bytes.
* `--concurrent-requests` Send up to this many CAR shards concurrently.

### `w3 ls`

List all the uploads registered in the current space.

* `--json` Format as newline delimited JSON
* `--shards` Pretty print with shards in output

### `w3 rm <root-cid>`

Remove an upload from the uploads listing. Note that this command does not remove the data from the IPFS network, nor does it remove it from space storage (by default).

* `--shards` Also remove all shards referenced by the upload from the store. Use with caution and ensure other uploads do not reference the same shards.

### `w3 open <cid>`

Open a CID on https://w3s.link in your browser. You can also pass a CID and a path.

```bash
# opens a browser to https://w3s.link/ipfs/bafybeidluj5ub7okodgg5v6l4x3nytpivvcouuxgzuioa6vodg3xt2uqle
w3 open bafybeidluj5ub7okodgg5v6l4x3nytpivvcouuxgzuioa6vodg3xt2uqle

# opens a browser to https://w3s.link/ipfs/bafybeidluj5ub7okodgg5v6l4x3nytpivvcouuxgzuioa6vodg3xt2uqle/olizilla.png
w3 open bafybeidluj5ub7okodgg5v6l4x3nytpivvcouuxgzuioa6vodg3xt2uqle/olizilla.png
```

### `w3 whoami`

Print information about the current agent.

### `w3 space add <proof.ucan>`

Add a space to the agent. The proof is a CAR encoded delegation to _this_ agent.

### `w3 space create [name]`

Create a new w3 space with an optional name.

### `w3 space ls`

List spaces known to the agent.

### `w3 space register`

Register the space by adding a storage provider and delegating all of its 
capabilities to the currently authorized account. If you are authorized against
more than one account you'll need to pass the `--email` option to specify which account to
register the space with.

* `--email` The email address of the account to associate this space with.
* `--provider` The storage provider to associate with this space.
> By registering your w3up beta Space with [web3.storage](http://web3.storage/), you agree to the w3up beta [Terms of Service](https://console.web3.storage/terms). Until the beta period is over and this migration occurs, uploads to w3up will not appear in your web3.storage account (and vice versa), even if you register with the same email.

### `w3 space use <did>`

Set the current space in use by the agent.

### `w3 space info`

Get information about a space (by default the current space) from the service, including
which providers the space is currently registered with.

* `--space` The space to get information about. Defaults to the current space.
* `--json` Format as newline delimited JSON

### `w3 delegation create <audience-did>`

Create a delegation to the passed audience for the given abilities with the _current_ space as the resource.

* `--can` A capability to delegate. To specify more than one capability, use this option more than once.
* `--name` Human readable name for the audience receiving the delegation.
* `--type` Type of the audience receiving the delegation, one of: device, app, service.
* `--output` Path of file to write the exported delegation data to.

```bash
# delegate space/info to did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN
w3 delegation create did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN --can space/info

# delegate store/* and upload/* to did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN
w3 delegation create did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN --can 'store/*' --can 'upload/*'

# delegate all capabilities to did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN
# WARNING - this is bad practice and should generally only be done in testing and development
w3 delegation create did:key:z6MkrwtRceSo2bE6vAY4gi8xPNfNszSpvf8MpAHnxVfMYreN --can '*'
```

### `w3 delegation ls`

List delegations created by this agent for others.

* `--json` Format as newline delimited JSON


### `w3 delegation revoke <delegation-cid>`

Revoke a delegation by CID.

* `--proof` Name of a file containing the delegation and any additional proofs needed to prove authority to revoke

### `w3 proof add <proof.ucan>`

Add a proof delegated to this agent. The proof is a CAR encoded delegation to _this_ agent. Note: you probably want to use `w3 space add` unless you know the delegation you received targets a resource _other_ than a w3 space.

### `w3 proof ls`

List proofs of delegated capabilities. Proofs are delegations with an audience matching the agent DID.

* `--json` Format as newline delimited JSON

### `w3 can space info <did>`

### `w3 can space recover <email>`

### `w3 can store add <car-path>`

Store a [CAR](https://ipld.io/specs/transport/car/carv1/) file to web3.storage.

### `w3 can store ls`

List CARs in the current space.

* `--json` Format as newline delimited JSON
* `--size` The desired number of results to return
* `--cursor` An opaque string included in a prior upload/list response that allows the service to provide the next "page" of results
* `--pre` If true, return the page of results preceding the cursor

### `w3 can store rm <shard-cid>`

Remove a CAR from the store.

### `w3 can upload add <root-cid> <shard-cid> [shard-cid...]`

Register an upload - a DAG with the given root data CID that is stored in the given CAR shard(s), identified by CAR CIDs.

### `w3 can upload ls`

List uploads in the current space.

* `--json` Format as newline delimited JSON
* `--shards` Pretty print with shards in output
* `--size` The desired number of results to return
* `--cursor` An opaque string included in a prior upload/list response that allows the service to provide the next "page" of results
* `--pre` If true, return the page of results preceding the cursor

### `w3 can upload rm <root-cid>`

Remove an upload from the current space's upload list. Does not remove CAR from the store.


## Environment Variables

By default, `w3` will use the w3up service at https://up.web3.storage. If you would like
to use a different w3up-compatible service, you can use the `W3UP_SERVICE_DID` and `W3UP_SERVICE_URL` environment variables to set the service DID and URL endpoint.

## FAQ

### Where are my keys and delegations stored?

In the system default user config directory:

- macOS: `~/Library/Preferences/w3access`
- Windows: `%APPDATA%\w3access\Config` (for example, `C:\Users\USERNAME\AppData\Roaming\w3access\Config`)
- Linux: `~/.config/w3access` (or `$XDG_CONFIG_HOME/w3access`)

## Contributing

Feel free to join in. All welcome. Please read our [contributing guidelines](https://github.com/web3-storage/w3cli/blob/main/CONTRIBUTING.md) and/or [open an issue](https://github.com/web3-storage/w3cli/issues)!

## License

Dual-licensed under [MIT + Apache 2.0](https://github.com/web3-storage/w3cli/blob/main/LICENSE.md)
