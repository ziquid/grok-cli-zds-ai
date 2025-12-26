FEATURES := bun

ALL_TARGET := pack

.PHONY: pack-and-copy
pack-and-copy pc: pack ## package, copy to $(BUN_PACKAGE_NAME_STRIPPED).tgz and zds-ai project
	cp $(BUN_PACKAGE_TARBALL) $(BUN_PACKAGE_NAME_STRIPPED).tgz
	cp $(BUN_PACKAGE_NAME_STRIPPED).tgz ~/sca/zds-ai
