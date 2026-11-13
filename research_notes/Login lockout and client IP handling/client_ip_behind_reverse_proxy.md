# Determining the real client IP behind reverse proxies (state: November 2026)

Scope: mechanisms, defaults, pitfalls and recommended practice for deriving a trustworthy client address for login
rate limiting in a self-hosted Next.js 16 container behind a reverse proxy such as Traefik. Versions seen in the
sources: Traefik v3.7 docs, Next.js 16.4.6 (installed package) and Next.js docs last updated 2026-10-15, Express 5,
Fastify 5.12, Echo v5.4.4, Rails 8.1.4.1, Django 6.1, django-ipware 8.x, Tomcat 11, Spring Boot 4.1, Nextcloud 35,
Podman 6.0. Items marked "not verified" could not be confirmed in a primary source during this research.

## Headers and protocols: what do they guarantee, and why "rightmost untrusted" instead of leftmost?

### Takeaway

No forwarding header guarantees anything by itself: only the part written by a proxy you control is trustworthy, and
only if the application cannot be reached around that proxy. The correct client address for security purposes is the
first address, counted from the right of the full `X-Forwarded-For` list, that was not added by one of your own
proxies ("rightmost untrusted" / "rightmost-ish"); the leftmost entry is whatever the client chose to send.

### Cited Findings

`X-Forwarded-For` (XFF)

- XFF is a de-facto standard, "Not part of any current specification"; the standardized version is `Forwarded`, which
  is "much less frequently used". Syntax `X-Forwarded-For: <client>, <proxy>, …, <proxyN>`; the leftmost address is
  the originating client only "assuming well-behaved client and proxies" —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- MDN security guidance (verbatim): "If the server can be directly connected to from the internet — even if it is also
  behind a trusted reverse proxy — **no part** of the `X-Forwarded-For` IP list can be considered trustworthy or safe
  for security-related uses." —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- MDN (verbatim): "Any security-related use of `X-Forwarded-For` (such as for rate limiting or IP-based access
  control) _must only_ use IP addresses added by a trusted proxy. Using untrustworthy values can result in
  rate-limiter avoidance, access-control bypass, memory exhaustion, or other negative security or availability
  consequences." and "Leftmost (untrusted) values must only be used for cases where there is no negative impact from
  using spoofed values." —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- MDN describes two selection methods. Trusted proxy count: "The count of reverse proxies between the internet and
  the server is configured. The `X-Forwarded-For` IP list is searched from the rightmost by that count minus one."
  Trusted proxy list: "The IPs or IP ranges of the trusted reverse proxies are configured. The `X-Forwarded-For` IP
  list is searched from the rightmost, skipping all addresses that are on the trusted proxy list. The first
  non-matching address is the target address." —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- MDN: "The first trustworthy `X-Forwarded-For` IP address may belong to an untrusted intermediate proxy rather than
  the actual client, but it is the only IP suitable to identify a client for security purposes." —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- Multiple header lines: "There may be multiple `X-Forwarded-For` headers present in a request. The IP addresses in
  these headers must be treated as a single list … It is insufficient to use only one of multiple `X-Forwarded-For`
  headers." —
  [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- Why leftmost is untrustworthy in practice: appending proxies keep whatever the client sent. AWS ALB default mode
  `append`: a request sent with `X-Forwarded-For: 127.0.0.4` reaches the target as
  `X-Forwarded-For: 127.0.0.4, 127.0.0.1` (the last hop appended on the right). AWS: "The entries can only be
  considered trustworthy if added by systems that are properly secured within the network." —
  [AWS ALB X-Forwarded headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)

"The perils of the 'real' client IP" (adam-p, March 2022, updated June 2026)

- Thesis: "leftmost-ish" (leftmost valid, non-private IP) is closest to the client but spoofable by anyone and must
  not be used for anything security-related; "rightmost-ish" (walk leftward from the right past your trusted
  proxies) is the only trustworthy value and should be the default. The socket peer address (`RemoteAddr`) is not in
  the XFF list; use it for direct connections and to verify the proxy —
  [adam-p: The perils of the "real" client IP](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Trusted proxy list vs. count: the author prefers configuring proxy IPs/CIDRs because counts break when the network
  architecture changes; a "rightmost non-private" variant is only acceptable if all proxies live in private address
  space (fails behind e.g. Cloudflare) —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Recommendations: use the rightmost-ish IP of the full list; only read single-IP headers such as `X-Real-IP` if you
  know your proxy always sets them; do not let an existing "true client IP" header pass through; do not rely on
  defaults (rate limiters should require explicit configuration) —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Pitfalls listed: client-supplied entries; multiple header lines (Go's `Header.Get` returns only the first line);
  inconsistent splitting (comma vs. comma-space); private addresses at the left; plain HTTP hops; headers such as
  `X-Client-IP` / `True-Client-IP` passing through proxies untouched (AWS ALB); AWS ALB optional client-port
  preservation putting `ip:port` in XFF —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Abuse consequences: spoofing a new leftmost IP per request escapes rate limits; unvalidated header strings used as
  limiter keys enable memory exhaustion (strings up to about 1 MB, Go's default header limit); where a server is both
  directly reachable and behind a proxy, an attacker can craft XFF to mimic the proxy pattern, so check `RemoteAddr`
  first. Using the rightmost IP may block a shared proxy, which the author considers far better than being bypassed —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Projects and services the article found vulnerable or problematic:
  - go-chi/chi `RealIP` middleware (True-Client-IP, then X-Real-IP, then leftmost XFF) and go-chi/httprate (same
    logic; 2026 update: httprate now defaults to `RemoteAddr`, its opt-in real-IP path still takes leftmost XFF; chi
    v5.3.0 added a `ClientIP` API)
  - didip/tollbooth ("fails open": no limit if no IP is found; later fixed by maintainer PR)
  - ulule/limiter (`TrustForwardHeader` uses leftmost XFF)
  - sethvargo/go-limiter (whole XFF header value becomes the key)
  - Jetty (leftmost XFF)
  - phpList (leftmost XFF, apparently for login-related logic)
  - Tor (a directly reachable control server that is also behind a proxy)
  - gorilla/handlers `ProxyHeaders` (leftmost XFF and `Forwarded`)
  - IIS guidance (Microsoft blog says leftmost is the client; "woefully incomplete")
  - sebest/xff, pbojinov/request-ip, mo7zayed/reqip (leftmost, header fallbacks, no warnings); stanvit/go-forwarded
    (absolute rightmost, not correct for all topologies)
  - Fastly (`Fastly-Client-IP` spoofable by default), Akamai (`True-Client-IP` spoofable depending on two settings),
    Azure Front Door (`X-Azure-ClientIP` is leftmost-ish, `X-Azure-SocketIP` rightmost-ish)
  - two redacted entries pending disclosure
    — [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Rated good or acceptable by the article: Cloudflare `CF-Connecting-IP` (rightmost-ish), nginx realip module when
  fully configured, Apache mod_remoteip, Traefik's rate limiter (trusted proxy count), Express (XFF ignored by
  default; rightmost-ish option exists). The article itself names no CVE numbers —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- The HTTP Toolkit article (January 2024) gives the same rule: read the list right to left and take the first IP that
  is not yours; "there's no way whatsoever to verify" the entries before it; the edge proxy should overwrite the
  header (`proxy_set_header X-Forwarded-For $remote_addr;`) if downstream services might trust it blindly; backends
  must not be directly reachable. It calls `X-Real-IP` "rarely supported, and generally not recommended" —
  [HTTP Toolkit: What is X-Forwarded-For](https://httptoolkit.com/blog/what-is-x-forwarded-for/)

`X-Real-IP`

- Single-address header with no specification. nginx's realip module uses it as the default `real_ip_header`
  (`real_ip_header X-Real-IP;`) —
  [nginx realip module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)
- Traefik sets `X-Real-Ip` to the peer address only when the header is absent; for untrusted peers the incoming value
  has already been deleted (see the Traefik section) —
  [Traefik source forwarded_header.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/middlewares/forwardedheaders/forwarded_header.go)

`Forwarded` (RFC 7239)

- Parameters `for`, `by`, `host`, `proto`; each proxy may append its element after a comma or add a new field; "A
  proxy MAY remove all "Forwarded" header fields from a request"; IPv6 addresses must be quoted; identifiers may be
  obfuscated (`_token`) or `unknown` — [RFC 7239](https://www.rfc-editor.org/rfc/rfc7239.txt)
- Security considerations: the header "cannot be relied upon to be correct", it "may be modified, whether mistakenly
  or for malicious reasons, by every node on the way to the server"; a mitigation is to "verify the correctness of
  proxies and to whitelist them as trusted", but "the chain of IP addresses listed before the request came to the
  proxy cannot be trusted" — [RFC 7239](https://www.rfc-editor.org/rfc/rfc7239.txt)
- adam-p: `Forwarded` has the same spoofing problems as XFF, little adoption and a thin security section —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/). Express has no built-in support for `Forwarded` (as of
  5.1.0) — [express-rate-limit proxy troubleshooting](https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues)

`CF-Connecting-IP` / `True-Client-IP`

- `CF-Connecting-IP` "provides the client IP address connecting to Cloudflare to the origin web server"; it is sent
  only from Cloudflare's edge to the origin. `True-Client-IP` is Enterprise only and carries the same value. For XFF,
  "Cloudflare will append the IP address of the HTTP proxy connecting to Cloudflare to the header". Cloudflare warns
  that in a stacked CDN the `True-Client-IP` value can be spoofed unless set by you —
  [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- These headers are only trustworthy if the origin accepts traffic exclusively from the CDN; adam-p notes
  `CF-Connecting-IP` becomes spoofable when Cloudflare is bypassed, and that Cloudflare changed its IP list twice so
  trusted lists can go stale — [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)

PROXY protocol (v1/v2)

- Purpose: "provides a convenient way to safely transport connection information such as a client's address" across
  NAT or TCP proxies; the header is prepended once per connection, so it works for any TCP protocol and does "not
  require any protocol-specific knowledge on either side". v1 is a human-readable ASCII line (TCP4/TCP6/UNKNOWN,
  addresses, ports); v2 is binary with a 12-byte signature and optional TLVs —
  [HAProxy PROXY protocol spec](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt)
- Trust model: "The receiver MUST be configured to only receive the protocol described in this specification" and
  "MUST not try to guess whether the protocol header is present or not"; "The receiver SHOULD ensure proper access
  filtering so that only trusted proxies are allowed to use this protocol"; otherwise a normal client "will be able
  to hide his activities" —
  [HAProxy PROXY protocol spec](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt)

### Inferences

- The PROXY protocol replaces the transport-level peer address for the receiving proxy; it does not help the
  application directly unless the application's HTTP server speaks it. In a Traefik-plus-Next.js setup it is relevant
  only between an outer TCP load balancer and Traefik.
- For a single trusted proxy that overwrites XFF, "rightmost entry", "only entry" and `X-Real-IP` are the same value;
  the difference between the algorithms only appears with several proxies or with appending proxies.

### Gaps

- The adam-p article does not cover the PROXY protocol. Its statements about Caddy describe the 2022 state; current
  Caddy behaviour is documented in the reverse proxy section below.
- RFC 7239 gives no explicit processing rule for headers from untrusted peers beyond the general caution.

## Framework behaviour and defaults

### Takeaway

Mature frameworks ignore forwarding headers by default and require an explicit trust configuration (Express,
Fastify, ASP.NET Core, Spring Boot outside cloud platforms, Symfony/Laravel, Echo v5). Several others trust private
ranges or everything by default (Rails, Tomcat `RemoteIpValve`, Echo extractors, Gin, Echo v4, chi `RealIP`), and
these defaults are the source of recurring vulnerabilities. In 2026 Fastify removed pure hop-count trust because it
cannot validate the immediate peer.

### Cited Findings

Express 5 (`trust proxy`)

- Default `false`: "the app is understood as directly facing the client and the client's IP address is derived from
  `req.socket.remoteAddress`" — [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- `true`: "the client's IP address is understood as the left-most entry in the `X-Forwarded-For` header"; warning
  that the last trusted proxy must remove/overwrite `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
  "otherwise it may be possible for the client to provide any value" —
  [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- IP/subnet list (also `loopback`, `linklocal`, `uniquelocal`): "This works by checking if
  `req.socket.remoteAddress` is trusted. If so, then each address in `X-Forwarded-For` is checked from right to left
  until the first non-trusted address." — [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- Number (hops): "`req.socket.remoteAddress` is the first hop, and the rest are looked for in the `X-Forwarded-For`
  header from right to left"; warning: "ensure there are not multiple, different-length paths to the Express
  application such that the client can be less than the configured number of hops away, otherwise it may be possible
  for the client to provide any value" —
  [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- Function `(ip) => boolean` as custom trust check. `req.ip` / `req.ips` "are populated based on the socket address
  and `X-Forwarded-For` header, starting at the first untrusted address". Implemented with the `proxy-addr` package —
  [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)

express-rate-limit validations

- `ERR_ERL_PERMISSIVE_TRUST_PROXY`: "This error is logged when the trust proxy setting is set to `true`" because
  Express then returns the leftmost XFF entry, which a client can set, allowing bypass.
  `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`: logged when XFF is present while trust proxy is `false` (the default); this
  usually means limits apply globally instead of per user, or (if rare and no proxy exists) someone probing.
  `ERR_ERL_INVALID_IP_ADDRESS`: the key is not a valid IP or includes a port (a changing port is a bypass). All can
  be disabled individually via `validate` —
  [express-rate-limit error codes](https://github.com/express-rate-limit/express-rate-limit/wiki/Error-Codes)
- Further validations exist for `forwardedHeader` (`ERR_ERL_FORWARDED_HEADER`), `keyGeneratorIpFallback`
  (`ERR_ERL_KEY_GEN_IPV6`) and `ipv6Subnet` —
  [express-rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration)

Fastify 5 (`trustProxy`)

- Default `false`. `true` trusts all proxies; string/array trusts the given IPs/CIDRs; function
  `(address, hop) => boolean`. Number: "Not supported. Hop-count-only trust is disabled because it cannot validate
  the immediate peer." Custom functions must validate the address; hop-only checks such as `hop < 1` are unsafe when
  the origin can be reached directly. Values "must be treated as untrusted input" unless the proxy chain is
  explicitly trusted — [Fastify server reference](https://fastify.dev/docs/latest/Reference/Server/)
- Background: CVE-2026-16732 / GHSA-3m5p-2c4r-xxw2, "fastify vulnerable to X-Forwarded-* spoofing under trustProxy
  hop-count"; affected 5.8.3 up to before 5.12.1; fixed in 5.12.1 by disabling the numeric form at runtime and
  removing it from the types —
  [GitLab advisory CVE-2026-16732](https://advisories.gitlab.com/npm/fastify/CVE-2026-16732/) (read via search
  summary, advisory page itself not opened)

Koa

- `app.proxy` "when true proxy header fields will be trusted"; `app.proxyIpHeader` defaults to `X-Forwarded-For`;
  `app.maxIpsCount` "max ips read from proxy ip header, default to 0 (means infinity)". The docs warn that with
  `proxy_add_x_forwarded_for` style proxies "A malicious attacker can forge a client's ip address by forging a
  `X-Forwarded-For` request header" and suggest a different header or `maxIpsCount` when the number of proxies is
  known — [Koa docs](https://koajs.com/)

Rails 8.1 (`ActionDispatch::RemoteIp`)

- Selects "the last-set address that is not on the list of trusted IPs". Default trusted list (`TRUSTED_PROXIES`):
  `127.0.0.0/8`, `::1`, `fc00::/7`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fe80::/10`.
  `config.action_dispatch.trusted_proxies` takes an enumerable that replaces the default set (a single value raises
  `ArgumentError`). `ip_spoofing_check` is on by default and raises when Client-IP and X-Forwarded-For disagree.
  Docs warning: "IF YOU DON'T USE A PROXY, THIS MAKES YOU VULNERABLE TO IP SPOOFING." —
  [Rails API ActionDispatch::RemoteIp](https://api.rubyonrails.org/classes/ActionDispatch/RemoteIp.html)

Django 6.1 and django-ipware 8

- Django core has `SECURE_PROXY_SSL_HEADER` ("A tuple representing an HTTP header/value combination that signifies a
  request is secure") and `USE_X_FORWARDED_HOST`; the settings reference contains no setting for client IP /
  X-Forwarded-For — [Django settings](https://docs.djangoproject.com/en/stable/ref/settings/)
- django-ipware 8.x `get_client_ip`: without configuration it walks a precedence list of headers (starting with
  `X_FORWARDED_FOR`, ending with `REMOTE_ADDR`, including CDN headers) and "The first public IP wins"; default
  `proxy_order` is `left-most`. `proxy_count` fixes the number of proxies; `proxy_trusted_ips` lists trusted proxies
  and "Requests that did not come through them are rejected". README: "There is no perfect defense against IP
  address spoofing"; narrow the header list; clients "can send these headers themselves" —
  [django-ipware](https://github.com/un33k/django-ipware)

ASP.NET Core (`ForwardedHeadersMiddleware`)

- Not enabled by default outside IIS out-of-process hosting; default `ForwardedHeaders` is `None`. Defaults: "Only
  loopback addresses are configured for known proxies and known networks"; "The default `ForwardLimit` is `1` (one),
  so only the rightmost value from the headers is processed"; headers are processed "in reverse order from right to
  left" — [ASP.NET Core proxy and load balancer configuration](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
- "The request's original remote IP must match an entry in the `KnownProxies` or `KnownNetworks` lists before
  forwarded headers are processed. This limits header spoofing by not accepting forwarders from untrusted proxies."
  An unknown proxy is logged with its address —
  [ASP.NET Core proxy docs](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
- `ForwardLimit` may be `null` "but this should only be done if `KnownProxies` or `KnownNetworks` are configured".
  `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` "uses settings designed for cloud environments and doesn't enable
  features such as the `KnownProxies option`" (it clears both lists). "Clearing both lists allows forwarded headers
  from any peer. Don't use this as a default; only consider it when network access independently restricts callers."
  — [ASP.NET Core proxy docs](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)

Spring Boot and Tomcat

- `server.forward-headers-strategy`: `NATIVE` (web server handles `X-Forwarded-For` / `X-Forwarded-Proto`),
  `FRAMEWORK` (`ForwardedHeaderFilter`), default `NONE` except on supported cloud platforms where it is `NATIVE`.
  "You can trust all proxies by setting the `internal-proxies` to empty (but do not do so in production)." —
  [Spring Boot how-to: embedded web servers](https://docs.spring.io/spring-boot/how-to/webserver.html)
- Tomcat 11 `RemoteIpValve`: `remoteIpHeader` default `x-forwarded-for`; `internalProxies` default
  `10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 127.0.0.0/8, ::1/128, fe80::/10,
fc00::/7`; `trustedProxies` default none. The docs note the first proxy must strip incoming forwarded headers and
  that the default assumes all local networks are trusted —
  [Tomcat 11 valve reference](https://tomcat.apache.org/tomcat-11.0-doc/config/valve.html)

Go: chi, Echo, Gin

- chi `middleware.RealIP` is now marked deprecated in the source: "RealIP is vulnerable to IP spoofing — it mutates
  r.RemoteAddr to the leftmost X-Forwarded-For value, or to True-Client-IP / X-Real-IP whether or not your
  infrastructure actually sets them" (references GHSA-3fxj-6jh8-hvhx, GHSA-rjr7-jggh-pgcp, GHSA-9g5q-2w5x-hmxf);
  replacements `ClientIPFromHeader`, `ClientIPFromXFF`, `ClientIPFromXFFTrustedProxies`, `ClientIPFromRemoteAddr`
  with `GetClientIP` —
  [chi realip.go](https://raw.githubusercontent.com/go-chi/chi/master/middleware/realip.go)
- Echo v5: `Echo#IPExtractor` with `ExtractIPDirect()` (no proxy), `ExtractIPFromXFFHeader()` ("Never take the first
  one from the left, since the client controls it"), `ExtractIPFromRealIPHeader()`. The extractors trust loopback,
  link-local and private ranges by default ("By default it trusts internal IP addresses"); options
  `TrustLoopback(false)`, `TrustLinkLocal(false)`, `TrustPrivateNet(false)`, `TrustIPRange(...)`. In v5 without an
  extractor the direct peer address is used; in v4 "the default still trusts `X-Forwarded-For` and `X-Real-IP` from
  any client". "Never forget to configure the outermost proxy … not to pass through incoming headers." —
  [Echo IP address guide](https://echo.labstack.com/guide/ip-address/)
- Gin: "Gin trusts all proxies by default if you don't specify a trusted proxy using the function above, **this is
  NOT safe**"; `SetTrustedProxies([]string{...})`, `SetTrustedProxies(nil)` to disable; `Engine.TrustedPlatform`
  (`PlatformCloudflare`, `PlatformGoogleAppEngine`, `PlatformFlyIO` or a custom header) has "a higher priority than
  TrustedProxies" —
  [Gin trusted proxies](https://gin-gonic.com/en/docs/server-config/trusted-proxies/)

Laravel and Symfony

- Laravel: the `TrustProxies` middleware is configured with `trustProxies(at: [...])` (IPs/CIDRs) and a `headers`
  bitmask; `trustProxies(at: '*')` trusts all proxies (suggested for cloud load balancers with unknown IPs). The
  docs add: "In general, IP addresses should be considered untrusted, user-controlled input and be used for
  informational purposes only." — [Laravel requests](https://laravel.com/docs/12.x/requests)
- Symfony: `framework.trusted_proxies` (IPs/CIDRs, `private_ranges`, `REMOTE_ADDR`) and `framework.trusted_headers`
  (`x-forwarded-for`, … or `forwarded`); env vars `SYMFONY_TRUSTED_PROXIES` / `SYMFONY_TRUSTED_HEADERS`. Trusting
  `REMOTE_ADDR` (all peers) is only acceptable if the web server does "_not_ respond to traffic from _any_ clients
  other than your load balancers": "If you allow outside traffic, they could "spoof" their true IP address". The
  trusted-proxies feature "does not work as expected when using the nginx realip module" —
  [Symfony proxies](https://symfony.com/doc/current/deployment/proxies.html)

### Inferences

- Two families of defaults exist: "ignore headers until configured" (Express, Fastify, ASP.NET Core, Spring Boot,
  Symfony, Echo v5, Caddy, Traefik) and "trust private ranges or everything" (Rails, Tomcat valve, Echo extractors,
  Gin, Echo v4, chi RealIP, django-ipware default). The second family is safe only when the application is never
  reachable from a private-range peer that is not a proxy, which is often false inside container networks.
- ASP.NET Core combines both controls (peer must be a known proxy, and at most `ForwardLimit` entries are consumed);
  this is the strictest of the surveyed defaults.

### Gaps

- Django: the full text of the `SECURE_PROXY_SSL_HEADER` warning could not be retrieved (page truncated); the absence
  of a client-IP setting is based on the retrieved part of the reference and general knowledge.
- Koa docs do not state which entry `request.ip` takes from the list (not verified).
- Tomcat docs page does not describe the walk direction of the valve; right-to-left as in mod_remoteip is assumed,
  not verified.
- Symfony docs page does not state the default (no trusted proxies) or `getClientIp()` semantics explicitly.
- Whether .NET servicing releases changed the enforcement of known proxies (reported for mid-2025) was not verified.

## Next.js 15/16: how does a self-hosted application obtain the client IP?

### Takeaway

Next.js has no trusted-proxy setting and no client-IP API for self-hosting: `request.ip` was removed in 15.0.0, the
replacement `ipAddress()` from `@vercel/functions` just reads `x-real-ip` (set by Vercel's proxy), and the Node
server only fills `x-forwarded-for` from the socket address when the header is absent, passing any client-supplied
value through unchanged. A self-hosted application must therefore parse the forwarding headers itself and depend on
the reverse proxy (and network isolation) to make them trustworthy.

### Cited Findings

- Next.js 15 upgrade guide: "The `geo` and `ip` properties on `NextRequest` have been removed as these values are
  provided by your hosting provider." For Vercel the guide points to `geolocation` and `ipAddress` from
  `@vercel/functions`; the migration checklist says "`NextRequest` `geo` and `ip` consumers use an appropriate source
  for the actual hosting provider." —
  [Next.js upgrade guide v15](https://nextjs.org/docs/app/guides/upgrading/version-15)
- `NextRequest` version history: "`v15.0.0` | `ip` and `geo` removed." The current reference documents no IP
  property — [NextRequest reference](https://nextjs.org/docs/app/api-reference/functions/next-request)
- `@vercel/functions` `ipAddress()`: "Returns the IP address of the request from the headers." Implementation:
  `export const IP_HEADER_NAME = 'x-real-ip';` (doc comment "Client IP as calculated by Vercel Proxy") and
  `return getHeader(headers, IP_HEADER_NAME);` —
  [vercel/vercel headers.ts](https://raw.githubusercontent.com/vercel/vercel/main/packages/functions/src/headers.ts),
  [Vercel functions package docs](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- Next.js server source (`base-server.ts`, `handleRequestImpl`, canary; identical logic in the installed 16.4.6
  build at `node_modules/next/dist/server/base-server.js` line 604):
  `req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress`, alongside
  `x-forwarded-host ??= host`, `x-forwarded-port ??= …`, `x-forwarded-proto ??= …` under the comment
  "Update the `x-forwarded-*` headers." The `??=` operator only assigns when the header is missing —
  [vercel/next.js base-server.ts](https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/src/server/base-server.ts)
- Self-hosting guide: "When self-hosting, it's recommended to use a reverse proxy (like nginx) in front of your
  Next.js server rather than exposing it directly to the internet. A reverse proxy can handle malformed requests,
  slow connection attacks, payload size limits, rate limiting, and other security concerns". The guide contains no
  statement about client IP, `x-forwarded-for` or trusted proxies —
  [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)
- GitHub discussion "Access client IP address in server action" (#49730): accepted answer by a Next.js team member
  (2023-12-17): "Updated the docs here to make it more clear this depends on the infra provider, but you can also
  read some things from headers if provided." Community answers suggest setting `x-real-ip` in the reverse proxy and
  reading it with `headers()`. The thread does not discuss spoofing or trust —
  [vercel/next.js discussion #49730](https://github.com/vercel/next.js/discussions/49730)
- Server Actions use `x-forwarded-host` (falling back to `host`) for the CSRF origin comparison, with
  `serverActions.allowedOrigins` as the allow-list (installed 16.4.6 `action-handler.js`; comment "This is to prevent
  CSRF attacks. If `x-forwarded-host` is set, we need to …") — verified by local source inspection of the installed
  package; upstream file:
  [vercel/next.js action-handler.ts](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/app-render/action-handler.ts)
  (upstream URL not fetched)
- The ecosystem's answer for Next.js-style apps: better-auth reads `X-Forwarded-For` by default but documents three
  explicit configurations: a single proxy-set header (`advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`),
  a trusted proxy list for appending proxies (`advanced.ipAddress.trustedProxies`, "List the exact addresses of your
  proxies." "Do not use a wide range that also includes clients."), or `ipAddressHeaders: []` for direct exposure
  (then "all clients share one counter for each path"). Requests without a determinable address share one counter
  per path and a warning is logged; "make sure that clients can reach your server only through it [the proxy]" —
  [better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit)
- Third-party issue trackers report this exact weakness in Next.js-based applications (client-controlled
  `X-Forwarded-For` used as rate-limit or audit identity, fix: honour the header only behind a configured trusted
  proxy) — [example issue](https://github.com/actionplatform/action-platform/issues/296) (search-result summary,
  low-authority source)

### Inferences

- From the installed 16.4.6 build: `x-forwarded-for` appears in the server code only in `base-server.js`
  (`handleRequestImpl`); there is no `trustProxy`/trusted-proxy option in `config-shared.d.ts`. Middleware/proxy
  invocation goes through `requestHandler` -> `handleRequest` -> `handleRequestImpl` (the `middlewareInvoke` branch
  comes after the header fallback), so `proxy.ts`/middleware, route handlers and server actions (`headers()`) should
  all see the same `x-forwarded-for` value. This is a reading of compiled code, not a documented guarantee.
- Consequence of `??=`: behind a proxy that sets the header, the application code never sees the socket peer address
  (it is only used as fallback). A standard Next.js application (no custom server) therefore cannot verify that the
  immediate peer is a trusted proxy, unlike Express/Fastify/ASP.NET. A "trusted proxy CIDR" setting in the
  application can only be applied to the entries inside `X-Forwarded-For`, and the guarantee that the header was
  written by the proxy must come from network isolation (container reachable only through the proxy).
- If the Next.js container is reachable directly (published port, shared network with untrusted containers), any
  client can send an arbitrary `X-Forwarded-For` and the application will see it unchanged; MDN's "no part … can be
  considered trustworthy" applies in full.
- When the header is absent the fallback is Node's `socket.remoteAddress`, which on dual-stack sockets is typically
  an IPv4-mapped IPv6 string (`::ffff:a.b.c.d`); the application should normalise this (not verified in a primary
  source during this research; better-auth documents converting IPv4-mapped addresses to IPv4).

### Gaps

- No official Next.js documentation or maintainer statement was found that addresses spoofed `x-forwarded-for` in
  self-hosted deployments, and no vercel/next.js issue specifically about it was located. The only maintainer
  statement found is "this depends on the infra provider".
- Behaviour with a custom server, with the standalone output (`server.js`) versus `next start`, and in the edge
  runtime was not tested; the standalone server uses the same `base-server` code path (not separately verified).

## Reverse proxies: Traefik, nginx, Caddy, HAProxy, CDNs and load balancers

### Takeaway

Traefik v3 and Caddy are safe by default: they discard client-supplied forwarding headers from untrusted peers and
write their own, so a single default-configured Traefik hands the backend an `X-Forwarded-For` with exactly one
entry, the peer address Traefik saw. nginx (`$proxy_add_x_forwarded_for`), HAProxy and AWS ALB append to what the
client sent unless configured otherwise. Trust lists on the proxy (`trustedIPs`, `set_real_ip_from`,
`trusted_proxies`) are only needed when another proxy or CDN sits in front.

### Cited Findings

Traefik v3 (docs v3.7)

- Entry point options: `forwardedHeaders.trustedIPs` ("Set the IPs or CIDR from where Traefik trusts the forwarded
  headers information (`X-Forwarded-*`)"), `forwardedHeaders.insecure` (default `false`; "always trust the forwarded
  headers information"; "We recommend to use this option only for tests purposes, not in production"),
  `forwardedHeaders.notAppendXForwardedFor` (default `false`; "When set to `true`, Traefik will not append the
  client's `RemoteAddr` to the `X-Forwarded-For` header") —
  [Traefik entry points reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)
- Source: `if !x.insecure && !x.isTrustedIP(r.RemoteAddr) { DeleteXForwardedHeaders(r.Header) }`. `isTrustedIP`
  returns false when no checker is configured, so with defaults all managed headers are always removed. Managed
  headers: `X-Forwarded-Proto`, `X-Forwarded-Scheme`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Port`,
  `X-Forwarded-Server`, `X-Forwarded-Uri`, `X-Forwarded-Method`, `X-Forwarded-Prefix`,
  `X-Forwarded-Tls-Client-Cert`, `X-Forwarded-Tls-Client-Cert-Info`, `X-Scheme`, `X-Real-Ip` (underscore variants
  are matched too) —
  [Traefik forwarded_header.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/middlewares/forwardedheaders/forwarded_header.go)
- `X-Real-Ip` is set to the peer address (from `RemoteAddr`) only if absent:
  `if unsafeHeader(outreq.Header).Get(xRealIP) == "" { … Set(xRealIP, clientIP) }`; for a trusted peer an existing
  value is kept —
  [Traefik forwarded_header.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/middlewares/forwardedheaders/forwarded_header.go)
- The proxy stage appends the peer address to any remaining `X-Forwarded-For` values
  (`clientIP = strings.Join(prior, ", ") + ", " + clientIP`) unless `notAppendXFF` is set —
  [Traefik proxy.go](https://raw.githubusercontent.com/traefik/traefik/master/pkg/proxy/httputil/proxy.go)
- PROXY protocol on entry points: `proxyProtocol.trustedIPs` ("The replacement of the remote client address will
  occur only for IP addresses listed in `trustedIPs`"), `proxyProtocol.insecure` (trust every connection); v1 and v2
  detected automatically; an enabled entry point "can accept connections with or without PROXY protocol headers";
  warning: "When queuing Traefik behind another load-balancer, make sure to configure PROXY protocol on both sides.
  Not doing so could introduce a security risk in your system (enabling request forgery)." —
  [Traefik entry points reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)
- RateLimit middleware `sourceCriterion`: "If none are set, the default is to use the request's remote address
  field" (as an `ipStrategy`). `ipStrategy.depth` selects the Nth address from the right of XFF (default 0; if depth
  exceeds the list the client IP is empty); `ipStrategy.excludedIPs` scans XFF and selects the first address not in
  the list (ignored when depth is set); `ipStrategy.ipv6Subnet`: "If `ipv6Subnet` is provided and the selected IP is
  IPv6," it is "transformed into the first IP of the subnet it belongs to", "useful for grouping IPv6 addresses into
  subnets to prevent bypassing this middleware by obtaining a new IPv6"; applies to the depth and remote-address
  strategies only. Alternatives: `requestHeaderName`, `requestHost` —
  [Traefik RateLimit middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/)
- The middleware runs before proxying, so the previous hop is not yet in XFF and "cannot be found and/or relied
  upon" there. IPAllowList has the same `ipStrategy` (default: "match `sourceRange` against the Remote address found
  in the request"; `ipv6Subnet` valid range 1–128) —
  [Traefik RateLimit middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/),
  [Traefik IPAllowList middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ipallowlist/)

nginx

- `set_real_ip_from address | CIDR | unix:` "Defines trusted addresses that are known to send correct replacement
  addresses" (no default). `real_ip_header field | X-Real-IP | X-Forwarded-For | proxy_protocol` (default
  `X-Real-IP`). `real_ip_recursive` (default `off`): "If recursive search is disabled, the original client address
  that matches one of the trusted addresses is replaced by the last address sent in the request header field … If
  recursive search is enabled, the original client address that matches one of the trusted addresses is replaced by
  the last non-trusted address sent in the request header field." `$realip_remote_addr` "keeps the original client
  address" — [nginx realip module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)
- `$proxy_add_x_forwarded_for`: "the "X-Forwarded-For" client request header field with the `$remote_addr` variable
  appended to it, separated by a comma. If the "X-Forwarded-For" field is not present in the client request header,
  the `$proxy_add_x_forwarded_for` variable is equal to the `$remote_addr` variable." nginx sets no forwarding
  headers by default (defaults are only `Host $proxy_host` and `Connection close`) —
  [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

Caddy

- `reverse_proxy` defaults: it "sets or augments the X-Forwarded-For header field" and sets `X-Forwarded-Proto` and
  `X-Forwarded-Host`; for untrusted clients it "will ignore their values from incoming requests, to prevent
  spoofing"; values are only kept from `trusted_proxies`. The docs warn Cloudflare users they "may be vulnerable to
  spoofing of the X-Forwarded-For header" without further configuration —
  [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- Global server options: `trusted_proxies` ("By default, no proxies are trusted"; `static [private_ranges]
<ranges...>`; enables client IP parsing for logs, `{client_ip}` and the `client_ip` matcher); `client_ip_headers`
  ("By default, only `X-Forwarded-For` is considered"; "the first non-empty header value is used");
  `trusted_proxies_strict` (right-to-left parsing; opt-in since v2.8, disabled by default for backward
  compatibility; without it parsing is left-to-right and "The first untrusted IP address found becomes the real
  client address"; behind HAProxy, Cloudflare, AWS ALB or CloudFront the leftmost IP "may be spoofed by the client",
  and for AWS ALB "you will certainly want to enable this option"); `trusted_proxies_unix` (disabled by default) —
  [Caddy global options](https://caddyserver.com/docs/caddyfile/options)

HAProxy

- HAProxy documents four client-IP preservation mechanisms: adding a `Forwarded` header, adding an
  `X-Forwarded-For` header, enabling the PROXY protocol, and transparent proxying —
  [HAProxy client IP preservation](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/proxying-essentials/client-ip-preservation/)

CDNs and load balancers

- Cloudflare appends to XFF and supplies `CF-Connecting-IP`; it recommends reading `CF-Connecting-IP` or
  `True-Client-IP` because they contain a single address —
  [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- AWS ALB attribute `routing.http.xff_header_processing.mode` with values `append` (default), `preserve`, `remove`;
  in append mode the client-supplied header is kept and the client IP appended; optional client port preservation
  yields `ip:port` entries (IPv6 in brackets) —
  [AWS ALB X-Forwarded headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)

### Inferences

- With a single Traefik in front, default settings and no outer proxy, the backend receives `X-Forwarded-For` with
  exactly one entry and an identical `X-Real-Ip`, both equal to the TCP peer address Traefik observed. A client
  cannot inject additional entries. This follows from the two source files; the Traefik docs page itself does not
  describe the untrusted-peer behaviour in prose.
- If `forwardedHeaders.trustedIPs` is set too broadly (for example a whole private range that also contains
  clients) or `insecure` is enabled, Traefik passes client-supplied entries through and the backend must use the
  rightmost-untrusted algorithm; the single-entry guarantee is lost.
- When Traefik sits behind another proxy/CDN, `trustedIPs` must list exactly that proxy; then the backend receives
  `client-chain, outer-proxy-peer` plus Traefik's appended peer (the outer proxy's address), i.e. more than one
  entry, and the application needs either a trusted-proxy list, a hop count, or a proxy-normalised single header.
- nginx's commonly copied `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` appends to client input, so
  behind nginx the leftmost entry is attacker-controlled unless `$remote_addr` (after realip processing) is used
  instead.

### Gaps

- HAProxy `option forwardfor` details (appends a header, `if-none`, `except`, `header`), `send-proxy` /
  `send-proxy-v2` and `accept-proxy` could not be quoted from the configuration manual (page too large to retrieve);
  the statement that `option forwardfor` adds/appends an XFF header is from general knowledge, not verified here.
- Cloudflare's published IP ranges page and guidance to restrict origin access to those ranges were not retrieved.
- No Traefik documentation page was found that states the default dropping of forwarded headers in prose; the
  finding rests on the source code on the master branch (v3 line).

## Container networking: when does the reverse proxy lose the real source address?

### Takeaway

The proxy can only forward the address it sees as TCP peer. That address is the real client only if the container
runtime does not put a userspace forwarder or source NAT in front of the proxy: rootless Podman bridge networks
(`rootlessport`), Docker's userland proxy in some paths, Docker Desktop on macOS/Windows, Swarm's ingress mesh and
Kubernetes NodePort/LoadBalancer without `externalTrafficPolicy: Local` all replace the source address. Podman's
default rootless `pasta` network preserves it, custom rootless bridge networks historically did not; Podman 6 adds an
experimental pasta-based forwarder for bridges.

### Cited Findings

Podman (rootless)

- `pasta` is "the default for rootless containers" (since Podman 5.0.0, March 2024; before that slirp4netns) and its
  "Port forwarding preserves the original source IP address" —
  [podman-run](https://docs.podman.io/en/latest/markdown/podman-run.1.html),
  [podman-networking-docs](https://github.com/eriksjolund/podman-networking-docs)
- "For rootless bridge networks, port forwarding uses `rootlessport` by default", a userspace proxy. Current docs:
  `rootlessport` "attempts to preserve the original client source IP for remote TCP clients" (only when `nft` or
  `iptables` is available in the rootless network namespace); "UDP, loopback, and same-host connections typically
  still see a rewritten source" — [podman-run](https://docs.podman.io/en/latest/markdown/podman-run.1.html),
  [podman-create](https://docs.podman.io/en/latest/markdown/podman-create.1.html)
- Podman blog "Rootless Podman: Preserving Source IPs" (2026-09-04): the `rootlessport` proxy "rewrites the source to
  the container's own subnet address", which breaks IP-based access control, logging and rate limiting. Fix:
  `rootless_port_forwarder = "pasta"` under `[network]` in `containers.conf` switches rootless bridge networks to
  pasta's kernel-level forwarding via `pesto`, so "the original client IP is preserved all the way to the
  container". Requires passt >= 0^20260507.g1afd4ed; experimental; not the default; `rootlessport` forwards IPv6
  host traffic to IPv4-only containers, pasta does not; containers must be stopped before switching —
  [Podman blog feed](https://blog.podman.io/feed/); conflicts in wording with the current man page, which says
  `rootlessport` "attempts to preserve" the source for remote TCP clients
  ([podman-run](https://docs.podman.io/en/latest/markdown/podman-run.1.html))
- The man page describes the pasta forwarder as one that "reliably preserves the original client source IP for both
  TCP and UDP" and states "This option is experimental and its behavior is subject to change." —
  [podman-run](https://docs.podman.io/en/latest/markdown/podman-run.1.html)
- Summary table from the community networking guide: socket activation (systemd) preserves the source address with
  native performance; pasta preserves it; pasta + custom network does not ("Support for source address preserved
  for pasta + custom network is under development (see PR 28478)"); slirp4netns + `port_handler=slirp4netns`
  preserves it (slowest); slirp4netns + `port_handler=rootlesskit` does not (client appeared as 10.0.2.100); host
  network preserves it. Recommended for an HTTP reverse proxy: a socket-activated proxy container attached to a
  custom network with the backends, "to get source address preserved and native speed communication" —
  [podman-networking-docs](https://github.com/eriksjolund/podman-networking-docs)
- Podman 6.0 removed the slirp4netns rootless network stack (and the `--network-cmd-path` option); experimental
  pesto support arrived in 6.0.0 with `rootlessport` remaining the default —
  [Podman v6.0.0 release notes (mirror)](https://newreleases.io/project/github/podman-container-tools/podman/release/v6.0.0)
  (via search summary; the current `podman-run` page indeed no longer mentions slirp4netns)
- Traefik docs: "Socket activation is not supported by Docker but works with Podman containers." —
  [Traefik entry points reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)

Docker

- Port publishing with the default `nat` gateway mode sets up "NAT and masquerading rules … for each published
  container port"; `routed` mode sets up no NAT. "Ports on the host's IPv6 addresses will map to the container's
  IPv4 address" when no host IP is given, the bridge is IPv4-only and `--userland-proxy=true` (the default) —
  [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)
- Docker Desktop (macOS/Windows): "Docker Desktop's backend process listens on the specified host port" and
  "forwards the connection into the Linux VM where the container is running over a shared-memory channel"; "Inside
  the VM, the connection is routed to the container's internal IP address and port." The page does not state which
  source address the container sees —
  [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/)
- User reports: on Docker Desktop all requests appear to come from `192.168.65.1`, and host networking (available
  since 4.34) does not retain the source IP either —
  [Docker forum thread](https://forums.docker.com/t/services-that-need-to-know-source-ip-host-networking-only/141884)
  (forum report, not official)
- Swarm: the routing mesh makes every node accept connections on published ports; bypass it by publishing with the
  long syntax and "set `mode` to `host`", then only nodes running a task listen on the port —
  [Docker Swarm ingress](https://docs.docker.com/engine/swarm/ingress/). The ingress mesh's source NAT hiding the
  client IP (containers see a 10.255.0.x / ingress address) is tracked in moby issue 25526 according to forum
  threads — [Docker forum](https://forums.docker.com/t/incorrect-host-ip-address-while-access-apache-container-under-swarm-mode/37399)
  (secondary)

Kubernetes

- "Packets sent to Services with `Type=NodePort` are source NAT'd by default." With
  `service.spec.externalTrafficPolicy: Local`, "kube-proxy only proxies proxy requests to local endpoints, and does
  not forward traffic to other nodes. This approach preserves the original source IP address. If there are no local
  endpoints, packets sent to the node are dropped" —
  [Kubernetes: Using Source IP](https://kubernetes.io/docs/tutorials/services/source-ip/)
- `Type=LoadBalancer` is also source NAT'd by default; with `externalTrafficPolicy: Local` nodes without endpoints
  fail the `healthCheckNodePort` health check. Load balancers that terminate the client connection "must use an
  agreed upon protocol between the loadbalancer and backend to communicate the true client IP such as the HTTP
  Forwarded or X-FORWARDED-FOR headers, or the proxy protocol" —
  [Kubernetes: Using Source IP](https://kubernetes.io/docs/tutorials/services/source-ip/)

### Inferences

- Symptom to recognise: every request reaches the application with the same private address (bridge gateway, the
  container's own subnet, `10.0.2.100`, `192.168.65.1`, an ingress address). A login rate limit keyed on that
  address becomes a global limit, so one attacker can lock out all users; this is a fail-safe but
  availability-relevant outcome.
- For a rootless Podman deployment with Traefik and the application on a shared user-defined network, the client
  address reaching Traefik depends on the Podman version and configuration: socket activation or host networking for
  the proxy are the long-standing reliable options; `rootless_port_forwarder = "pasta"` is the Podman 6 option but
  experimental; default `rootlessport` should be assumed lossy unless tested.
- On a developer machine (Podman machine or Docker Desktop on macOS) the source address is not preserved at all, so
  client-IP behaviour cannot be verified locally with real addresses; tests must inject addresses at the proxy or
  header level.
- The trust boundary inside the container network: any container on the same network as the Next.js container can
  connect to it directly and forge `X-Forwarded-For`. Network segmentation (application reachable only by the proxy)
  is part of the trust assumption.

### Gaps

- Docker's documentation of the userland proxy's effect on the source address (`docker-proxy`, hairpin and localhost
  connections, `"userland-proxy": false`) was not found on the current docs pages retrieved; the claim that the
  userland proxy makes connections appear to come from the bridge gateway rests on forum posts and is not verified
  in a primary source.
- Rootless Docker port drivers (`builtin` vs. `slirp4netns`, source IP propagation) were not found on the retrieved
  rootless tips page; not verified.
- The moby issue for Swarm ingress source IP was not opened directly.
- No Traefik documentation recommendation specific to Podman source-IP preservation was found beyond the socket
  activation remark.
- The precise behaviour of `rootlessport` in Podman 6.x (docs: "attempts to preserve" for remote TCP; blog:
  "rewrites the source") is inconsistent between sources and should be tested on the target host.

## IPv6: why group by prefix, and which systems do it?

### Takeaway

An IPv6 end site controls at least a /64 (2^64 addresses) and commonly a /56 or /48, so per-address limits are
trivially bypassed by rotating addresses; limiter keys must be the prefix. /64 is the common default (Cloudflare,
better-auth, Traefik examples), /56 is used where the typical delegated prefix is the target (express-rate-limit,
Nextcloud).

### Cited Findings

- RIPE suggests /56 for home users and /48 for businesses; ISPs commonly assign /56, sometimes up to /48; the author
  assumes an attacker has at least a /56 and probably a /48. Recommendation: block per address first and escalate to
  /64, then larger prefixes (/60, /56, /52, /48), or as a quick fix "block /64s instead of individual IPs";
  unbounded limiter caches risk memory exhaustion —
  [adam-p: The scary state of IPv6 rate-limiting](https://adam-p.ca/blog/2022/02/ipv6-rate-limiting/)
- Cloudflare (as quoted in 2022): "Once an individual IPv4 address or IPv6 /64 IP range exceeds a rule threshold";
  Let's Encrypt limits account creation per /48; Nextcloud moved from per-/128 to per-/64 after a vulnerability
  report — [adam-p IPv6 article](https://adam-p.ca/blog/2022/02/ipv6-rate-limiting/),
  [HackerOne report 1154003](https://hackerone.com/reports/1154003) (report title seen in search results only)
- Nextcloud 35: `security.ipv6_normalized_subnet_size`, "For Brute Force Protection and Rate Limiting, IPv6
  addresses are truncated using subnet size. It defaults to /56, but you can set it between /32 and /64";
  `auth.bruteforce.max-attempts` default 10 —
  [Nextcloud config parameters](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/config_sample_php_parameters.html)
- Traefik `ipStrategy.ipv6Subnet` (RateLimit, IPAllowList and related middlewares): no default grouping; example
  `64` maps `::abcd:1111:2222:3333` to `::0:0:0:0`; purpose "to prevent bypassing this middleware by obtaining a new
  IPv6" —
  [Traefik RateLimit middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/)
- express-rate-limit `ipv6Subnet`: "The default value is 56, corresponding to a /56 subnet." "The valid range is
  1-128, but typically ISPs assign subnets in the range of 32-64, with 64 being the most common." Can be a function
  (per-ISP subnet) or `false`; custom key generators should use the exported `ipKeyGenerator` helper —
  [express-rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration)
- better-auth: CVE-2026-45364 / GHSA-p6v2-xcpg-h6xw (published 2026-05-11, CVSS 7.3 High), "Rate limiter keys IPv6
  addresses individually and is bypassable via prefix rotation": "ISPs and cloud providers assign prefixes, not
  addresses"; one /64 gives "2^64 distinct source addresses"; different textual forms of one address also created
  separate keys. Fixed in 1.4.17 / 1.5.0-beta.9 by normalising addresses and applying a default /64 mask
  (`advanced.ipAddress.ipv6Subnet`; common values 128, 64, 56, 48, 32) —
  [GitHub advisory GHSA-p6v2-xcpg-h6xw](https://github.com/advisories/GHSA-p6v2-xcpg-h6xw),
  [better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit)
- nginx `limit_req_zone $binary_remote_addr` keys per full address; workaround from the nginx mailing list (2021,
  nginx developer): a `map` on `$binary_remote_addr` capturing the first 8 bytes (`\C{8}`) as key for IPv6, falling
  back to the full value for IPv4 —
  [nginx mailing list, limit_req_zone for IPv6 subnets](https://mailman.nginx.org/pipermail/nginx/2021-April/060557.html)
  (via search summary)

### Inferences

- Normalisation belongs in the same step as prefix masking: parse the address, convert IPv4-mapped IPv6 to IPv4,
  strip zone identifiers and ports, mask IPv6 to the chosen prefix, and use the canonical text form as key; otherwise
  equivalent spellings create distinct buckets (the second half of the better-auth advisory).
- A /64 key is the conservative minimum; a /56 key matches typical residential delegations at the cost of grouping
  more unrelated users on some hosters. Making the prefix length configurable (as Nextcloud, express-rate-limit,
  better-auth and Traefik do) is the common design.
- If both the proxy (Traefik `ipv6Subnet`) and the application apply limits, using the same prefix length on both
  layers keeps the buckets consistent.

### Gaps

- Cloudflare's current rate-limiting parameter documentation does not mention /64 grouping; the /64 statement is a
  2022 quotation in the adam-p article and could not be re-verified against current Cloudflare docs.
- The express-rate-limit page does not state the version in which `ipv6Subnet` was introduced.
- The nginx mailing-list post was not opened directly.

## Design patterns for the application's configuration

### Takeaway

Three patterns exist: a trusted-proxy address list (walk XFF from the right, skip trusted addresses), a hop count
(take the Nth entry from the right), and a single named header that the proxy always overwrites. All three are only
sound if the application cannot be reached except through the proxy; the address list is preferred by most guidance,
the hop count is simplest but breaks silently on topology changes, and the fail-safe default when nothing is
configured is to ignore all headers and use the peer address.

### Cited Findings

- Preference for address lists over counts: counts break when the architecture changes —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/). Hop-count pitfall: "ensure there are not multiple,
  different-length paths to the Express application such that the client can be less than the configured number of
  hops away" — [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html). Fastify removed
  hop-count-only trust in 5.12.1 because it "cannot validate the immediate peer" —
  [Fastify server reference](https://fastify.dev/docs/latest/Reference/Server/)
- Address-list pitfalls: lists go stale (Cloudflare changed its ranges twice) —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/); ranges must not include clients ("List the exact
  addresses of your proxies." "Do not use a wide range that also includes clients.") —
  [better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit); cloud load balancers may have
  no stable range, leading to "trust all" configurations that are only acceptable when the server does not respond
  to traffic from anything but the load balancer —
  [Symfony proxies](https://symfony.com/doc/current/deployment/proxies.html),
  [ASP.NET Core proxy docs](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer)
- Single named header: only read a single-IP header "if you know your proxy always sets" it; never let an existing
  one pass through — [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/). better-auth: list only that header;
  the proxy must overwrite any client-supplied value; "A client could set any other header in the list." —
  [better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit). Gin: with a custom
  `TrustedPlatform` header the CDN must prevent users from passing it —
  [Gin trusted proxies](https://gin-gonic.com/en/docs/server-config/trusted-proxies/)
- Fail-safe default: Express, Fastify, Echo v5, Caddy and ASP.NET Core use the peer address when nothing is
  configured (sources above). The cost is that behind a proxy all clients share one address: express-rate-limit
  logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` because "limits apply globally instead of per user" —
  [express-rate-limit error codes](https://github.com/express-rate-limit/express-rate-limit/wiki/Error-Codes);
  Echo kept the trusting default in v4 because changing it would merge all clients behind a proxy into one bucket —
  [GitLab advisory CVE-2026-118653](https://advisories.gitlab.com/golang/github.com/labstack/echo/v5/CVE-2026-118653/)
  (v4 rationale via search summary)
- Insecure defaults are classified as vulnerabilities: Misskey's `trustProxy` "is initialized with an insecure
  default value before version 2025.12.0" (CWE-1188, Initialization of a Resource with an Insecure Default; fix:
  default `false`) —
  [Misskey advisory GHSA-wwrj-3hvj-prpm](https://github.com/misskey-dev/misskey/security/advisories/GHSA-wwrj-3hvj-prpm)
- Behaviour when no address can be determined: better-auth puts such requests into one shared counter per path and
  logs a warning once; tollbooth was criticised for failing open (no limit when no IP is found) —
  [better-auth rate limit docs](https://www.better-auth.com/docs/concepts/rate-limit),
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)
- Documented verification procedures: express-rate-limit recommends a temporary `/ip` endpoint that returns
  `request.ip`, comparing the result with the public IP (e.g. api.ipify.org) and adjusting the hop count: if it does
  not match, "keep increasing the number until it does" —
  [express-rate-limit proxy troubleshooting](https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues).
  ASP.NET Core logs the address of an unknown proxy so it can be added to `KnownProxies` —
  [ASP.NET Core proxy docs](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer).
  The Misskey advisory's proof of concept is a login request carrying a forged `X-Forwarded-For` header —
  [Misskey advisory](https://github.com/misskey-dev/misskey/security/advisories/GHSA-wwrj-3hvj-prpm)
- Defence in depth beyond the address: Laravel states "IP addresses should be considered untrusted, user-controlled
  input" — [Laravel requests](https://laravel.com/docs/12.x/requests); django-ipware: "treat it as one layer
  alongside your firewall — never as the only defense" — [django-ipware](https://github.com/un33k/django-ipware)

### Inferences

- Comparison for a Next.js application, where the peer address is not available to application code once the header
  is present:
  - Trusted-proxy CIDR list applied to XFF entries: robust against extra hops and against client-supplied entries to
    the left; needs the proxy/CDN addresses to be known and stable; in a container network the "proxy address" is
    the proxy's address as seen by the next hop, which matters only with two or more proxies.
  - Hop count: one integer, no addresses needed, suits dynamic container IPs; wrong (and spoofable) if the request
    path has fewer hops than configured, harmlessly over-grouping (yields a proxy address) if it has more.
  - Single named header (e.g. `X-Real-Ip` from Traefik): simplest to parse (exactly one value expected; reject lists);
    safe with Traefik defaults because Traefik deletes the client-supplied header from untrusted peers; with a
    trusted outer proxy Traefik keeps the incoming value, so correctness then depends on the outer proxy.
- With exactly one default-configured Traefik, all three patterns yield the same address (XFF has one entry). The
  simplest robust rule set for the application is: no configuration means "do not read any header, treat the peer
  as unknown/shared"; configured hop count 1 means "take the rightmost XFF entry"; anything else must be explicit.
- Fail-safe choice when nothing is configured: do not derive a per-client address from headers. For a login lockout
  this means per-address limits degrade to a global or per-account limit instead of being bypassable. Startup or
  first-request diagnostics (header present but not configured; configured but header absent; more entries than
  expected; private or loopback result) follow the express-rate-limit and better-auth precedent of warning rather
  than silently guessing.
- A documented operator check should have two parts: (1) a positive test, that a request from a known external
  address is recorded with that address (login audit log or a diagnostic page for administrators); (2) a negative
  test, that a request sent with a forged `X-Forwarded-For: 1.2.3.4` (and `X-Real-Ip`) does not change the recorded
  address.
- Because the address may legitimately be a shared one (NAT, CGNAT, corporate proxy, lost source IP in the
  container runtime), a per-account counter in addition to the per-address counter keeps lockout meaningful when the
  address is unreliable.

### Gaps

- The Traefik `whoami` container as a documented verification tool was not retrieved from a primary source; its use
  for this purpose is common practice but not cited here.
- No authoritative source ranks the three patterns for applications that cannot see the peer address (the Next.js
  situation); the comparison above is inference.

## Notable CVEs and incidents

### Takeaway

Trusting a client-controllable forwarding header in a login or rate-limit path is a recurring vulnerability class
with a steady stream of advisories in 2025 and 2026, including in frameworks themselves (Echo, Fastify, Gin, chi)
and in a Next.js-ecosystem auth library (better-auth, IPv6 variant). Typical impact is unlimited password guessing
and log or ban evasion; typical fix is "default to the peer address, require explicit proxy trust".

### Cited Findings

- Misskey, CVE-2025-66482 / GHSA-wwrj-3hvj-prpm (published 2025-12-13, CVSS v4 6.9 Moderate, CWE-307 and CWE-1188):
  "attackers can bypass IP rate limiting by adding a forged X-Forwarded-For header"; impact "An attacker can brute
  force accounts bypassing rate limiting protection"; `trustProxy` option added in 2025.9.1 but with an insecure
  default until 2025.12.0, which changed the default to `false` —
  [Misskey advisory](https://github.com/misskey-dev/misskey/security/advisories/GHSA-wwrj-3hvj-prpm)
- Vikunja, CVE-2026-29794 / GHSA-m547-hp4w-j6jx (published 2026-03-20, CVSS 5.3, CWE-807): unauthenticated users
  can "bypass the application's built-in rate-limits by spoofing the `X-Forwarded-For` or `X-Real-IP` headers"
  because the key came from Echo's `c.RealIP()`; "Some reverse proxies like Traefik will overwrite this value by
  default, but others will not"; fixed in 2.2.0 —
  [GitHub advisory GHSA-m547-hp4w-j6jx](https://github.com/advisories/GHSA-m547-hp4w-j6jx)
- Echo (Go framework), CVE-2026-118653 / GHSA-246p-cpwv-v3jq (published 2026-10-28, CVSS 5.3, CWE-290): with
  `echo.New()` and no `IPExtractor`, "the `RealIP()` method falls back to reading the client-supplied
  `X-Forwarded-For`", so "an attacker can rotate arbitrary values in the X-Forwarded-For header on each request";
  fixed in v5.1.0 (default is now the direct peer; old behaviour available as `LegacyIPExtractor`) —
  [GitLab advisory CVE-2026-118653](https://advisories.gitlab.com/golang/github.com/labstack/echo/v5/CVE-2026-118653/)
- Fastify, CVE-2026-16732 / GHSA-3m5p-2c4r-xxw2: numeric `trustProxy` (hop count) ignored the connecting address, so
  a client reaching the origin directly could spoof forwarded headers; affected 5.8.3 to before 5.12.1; fix disables
  the numeric form —
  [GitLab advisory CVE-2026-16732](https://advisories.gitlab.com/npm/fastify/CVE-2026-16732/) (via search summary),
  consistent with [Fastify server reference](https://fastify.dev/docs/latest/Reference/Server/)
- Gin, CVE-2020-28483 / GHSA-h395-qcrw-5vmq (CVSS 7.1 High): "When gin is exposed directly to the internet, a
  client's IP can be spoofed by setting the X-Forwarded-For header."; fixed in 1.7.7. Gin still documents that it
  trusts all proxies by default —
  [GitHub advisory GHSA-h395-qcrw-5vmq](https://github.com/advisories/GHSA-h395-qcrw-5vmq),
  [Gin trusted proxies](https://gin-gonic.com/en/docs/server-config/trusted-proxies/)
- chi: `RealIP` deprecated with reference to three advisories (GHSA-3fxj-6jh8-hvhx, GHSA-rjr7-jggh-pgcp,
  GHSA-9g5q-2w5x-hmxf) — [chi realip.go](https://raw.githubusercontent.com/go-chi/chi/master/middleware/realip.go)
- better-auth, CVE-2026-45364 (IPv6 prefix rotation, see IPv6 section): impact on `/sign-in/email` brute-force and
  credential-stuffing limits — [GitHub advisory GHSA-p6v2-xcpg-h6xw](https://github.com/advisories/GHSA-p6v2-xcpg-h6xw)
- Reported in search results only (advisory pages not opened, treat as unverified): 9router CVE-2026-55501
  ([GHSA-7cfm-pqrj-xgq7](https://github.com/advisories/GHSA-7cfm-pqrj-xgq7), dashboard login limiter keyed on XFF
  without trusted-proxy check); Zipline CVE-2026-126934 (fresh buckets per XFF value when `core.trustProxy` is
  enabled; login passwords and TOTP codes guessable;
  [vuldb](https://vuldb.com/cve/CVE-2026-126934)); Remark42 CVE-2026-77463
  ([GitLab advisory](https://advisories.gitlab.com/golang/github.com/umputun/remark42/CVE-2026-77463/)); Gophish
  CVE-2026-107271 (`/login` throttling; [aggregator](https://cve.threatint.com/CVE/CVE-2026-107271)); Litestar
  CVE-2025-59152 ([GitLab advisory](https://advisories.gitlab.com/pypi/litestar/CVE-2025-59152/)); pyLoad
  CVE-2025-54802 (aggregator only)
- Earlier findings without CVE numbers: the adam-p survey (2022) of chi, tollbooth, ulule/limiter, go-limiter,
  Jetty, phpList, Tor, gorilla/handlers, Fastly, Akamai, Azure Front Door —
  [adam-p](https://adam-p.ca/blog/2022/03/x-forwarded-for/)

### Inferences

- The advisories share three root causes: reading the leftmost XFF entry; trusting headers regardless of the peer
  (insecure default or trust-all option); and keying on a raw, unnormalised string (IPv6 rotation, ports, textual
  variants). A design that defaults to no header trust, selects the rightmost untrusted entry, and normalises plus
  prefix-masks the address avoids all three.
- Several advisories were rated only Medium because the deployment is safe behind a proxy that overwrites the
  header (as Traefik does by default); the application-side weakness becomes exploitable when the deployment
  differs from the assumed topology. Documentation of the required topology is therefore part of the fix in most of
  these projects.

### Gaps

- The six-digit 2026 CVE identifiers listed as "search results only" were not checked against NVD or the vendor
  advisories; version ranges for Echo differ between aggregators (GitLab: all versions before 5.1.0).
- No incident reports (as opposed to advisories) of real-world exploitation were researched.
- No CVE specific to Next.js core and `x-forwarded-for` client-IP spoofing was found.
