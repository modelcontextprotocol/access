.PHONY: help login preview up

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# Production stack commands
login: ## Login to Pulumi backend (GCS)
	pulumi login gs://mcp-access-prod-pulumi-state

preview: login ## Preview infrastructure changes
	pulumi preview --stack prod

up: login ## Deploy infrastructure
	pulumi up --yes --stack prod