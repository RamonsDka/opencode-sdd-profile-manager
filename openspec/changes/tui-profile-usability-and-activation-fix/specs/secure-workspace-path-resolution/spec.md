# Secure Workspace Path Resolution Specification

## Purpose

Define deterministic, secure path resolution for external plugin and workspace references when `OPENCODE_WORKSPACE_ROOT` is configured or absent, ensuring path segments and spaces are preserved across platforms.

## Requirements

### Requirement: Workspace Root Segment Joining and Space Preservation

When `OPENCODE_WORKSPACE_ROOT` is defined, the path resolver MUST join the root path with all provided trailing path segments, MUST preserve whitespace within directory and file names, and MUST normalize the resulting absolute path. When `OPENCODE_WORKSPACE_ROOT` is absent, the resolver MUST join the user home directory with all trailing segments.

#### Scenario: Resolving Path with Configured Workspace Root and Spaces
- GIVEN `OPENCODE_WORKSPACE_ROOT` set to `C:\Users\DELL\projects\0.-MEJORA-OPENCODE-TRABAJANDO`
- WHEN resolving relative segments `["sdd-engram", "dist", "index.js"]`
- THEN the resolved path is `C:\Users\DELL\projects\0.-MEJORA-OPENCODE-TRABAJANDO\sdd-engram\dist\index.js` with trailing segments and space preserved

#### Scenario: Resolving Path with Default Home Directory
- GIVEN `OPENCODE_WORKSPACE_ROOT` is unset
- WHEN resolving relative segments `[".config", "opencode", "plugins"]`
- THEN the resolver joins the user home directory with all segments into a normalized absolute path

### Requirement: Deterministic Target Error Reporting

When a resolved path does not exist or points to an invalid target, the resolver MUST return or log an error containing the complete resolved path without truncating at spaces or segment boundaries.

#### Scenario: Non-Existent Target Path Reporting
- GIVEN a target path containing directory names with spaces that does not exist
- WHEN resolution verification fails
- THEN the error message contains the full untruncated absolute path

### Requirement: Reliable Profile Plugin Activation

Profile activation MUST resolve plugin directory paths through the segment-preserving resolver, preventing directory import failures caused by dropped path segments.

#### Scenario: Activating Profile with Workspace Plugins
- GIVEN an active profile referencing workspace plugins in a folder path with spaces
- WHEN the profile is activated
- THEN plugin modules load from the complete resolved path without missing segment errors
