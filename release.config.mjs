/**
 * The version lives in the git tag. package.json is bumped only inside the
 * release run, so the build picks the version up and nothing is pushed back to
 * main. After a release, the version goes to the workflow's output, and
 * release.yml hands that tag to the publish-edge and publish-firefox workflows.
 */
export default {
  branches: ['main'],
  plugins: [
    // Stays below 1.0: a breaking change is a minor version until this rule is removed.
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', releaseRules: [{ breaking: true, release: 'minor' }] }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'npm run zip && npm run check:sources',
        successCmd: 'echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [{ path: '.output/landing-tab-*.zip' }],
        successComment: false,
        failComment: false,
        releasedLabels: false,
      },
    ],
  ],
};
