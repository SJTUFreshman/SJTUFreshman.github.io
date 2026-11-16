'use strict';
// Preserve the group-only entry point and desktop/mobile coverage.
process.argv.push('--group-only');
require('./validate-friend-interactions.cjs');
