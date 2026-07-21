import nock from 'nock';

afterEach(() => {
  nock.cleanAll();
  nock.abortPendingRequests();
});

afterAll(() => {
  nock.restore();
  nock.enableNetConnect();
});
