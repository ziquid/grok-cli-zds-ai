FEATURES := bun

ALL_TARGET := pack

.PHONY: copy
copy: ## copy to $(BUN_PACKAGE_NAME_STRIPPED).tgz and zds-ai project
	cp $(BUN_PACKAGE_TARBALL) $(BUN_PACKAGE_NAME_STRIPPED).tgz
	cp $(BUN_PACKAGE_NAME_STRIPPED).tgz ~/sca/zds-ai

.PHONY: pack-and-copy
pack-and-copy pac pc: pack-quiet copy ## package quietly, copy to $(BUN_PACKAGE_NAME_STRIPPED).tgz and zds-ai project
	@:

.PHONY: prigc
prigc: pqrig copy ## build, pack quietly, reinstall globally, and copy
	@:
