.PHONY: help login preview up

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# Production stack commands
login: ## Login to Pulumi backend (GCS)
	pulumi login gs://mcp-access-prod-pulumi-state

preview: login ## Preview infrastructure changes
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi preview --stack prod

cleanup-state: login ## Remove orphaned resources from state
	@echo "Cleaning up orphaned state entries..."
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::dsp-ant-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::maxisbey-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::bhosmer-ant-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::crondinini-ant-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::ochafik-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::ihrpr-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::jerome3o-anthropic-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::felixweinberger-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::maheshmurag-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/teamMembership:TeamMembership::domdomegg-core' --yes 2>/dev/null
	-PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi state delete --stack prod 'urn:pulumi:prod::mcp-access::github:index/team:Team::core' --yes 2>/dev/null
	@echo "State cleanup complete"

up: login cleanup-state ## Deploy infrastructure
	PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt pulumi up --yes --stack prod