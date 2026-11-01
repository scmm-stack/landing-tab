/**
 * The version lives in the git tag. package.json is bumped only inside the
 * release run, so the build picks the version up and nothing is pushed back to
 * main. Store uploads are separate: see .github/workflows/publish-edge.yml.
 */
export default {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/npm', { npmPublish: false }],
    ['@semantic-release/exec', { prepareCmd: 'npm run zip' }],
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
