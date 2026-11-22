# Release sec-ownership-disclosures to npm from a clean, synced main.
#   make release        verify, publish (npm asks for 2FA in the browser), tag vX.Y.Z and push the tag
#   make release-check  everything except publish and tag; safe to re-run
# Bump the version in package.json and package-lock.json (and CHANGELOG.md) in the release commit first.

.PHONY: release release-check release-preflight release-tag

VERSION := $(shell node -p "require('./package.json').version")
NAME := $(shell node -p "require('./package.json').name")

release-preflight:
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "release from main (on $$(git rev-parse --abbrev-ref HEAD))"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "working tree is not clean"; exit 1; }
	@git fetch -q origin main
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "main is not origin/main; git pull first"; exit 1; }
	@test "$$(node -p "require('./package-lock.json').version")" = "$(VERSION)" || { echo "package-lock.json version differs from package.json"; exit 1; }
	@if git rev-parse -q --verify "refs/tags/v$(VERSION)" >/dev/null; then echo "tag v$(VERSION) already exists"; exit 1; fi
	@if npm view "$(NAME)@$(VERSION)" version >/dev/null 2>&1; then echo "$(NAME)@$(VERSION) is already on npm; bump the version"; exit 1; fi
	@echo "releasing $(NAME)@$(VERSION) from $$(git rev-parse --short HEAD)"

release-check: release-preflight
	npm ci
	npm run typecheck
	npm run typecheck:examples
	npm audit --omit=dev --audit-level=high
	npm run verify:release

release: release-check
	npm publish
	$(MAKE) release-tag

# Tags the release commit; use alone to finish a release whose publish already succeeded.
release-tag:
	git tag -a "v$(VERSION)" -m "$(NAME) $(VERSION)"
	git push origin "v$(VERSION)"
	@echo "Published $(NAME)@$(VERSION) and pushed tag v$(VERSION). The registry can take a few minutes to list it."
