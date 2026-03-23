.PHONY: help login preview refresh up

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# Production stack commands
login: ## Login to Pulumi backend (GCS)
	pulumi login gs://mcp-access-prod-pulumi-state

preview: login ## Preview infrastructure changes
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi preview --stack prod

refresh: login ## Refresh state to match reality
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi refresh --yes --stack prod

up: login ## Deploy infrastructure (with refresh to detect drift, e.g. expired org invites)
	# Dynamic providers serialize their implementation into state. Run a plain
	# `up` first so any provider-code changes are captured, then refresh with the
	# freshly serialized `read()`. Otherwise refresh runs stale code and fails.
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi up --yes --stack prod
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi up --refresh --yes --stack prod
