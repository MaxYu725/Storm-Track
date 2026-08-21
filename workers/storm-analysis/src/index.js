import worker, { handleAi23Request, TRUTH_AUGMENTATION_REPOSITORY_VERSION } from './index-ai23.js';

export {
  MAX_BODY_BYTES,
  constantTimeSecretEqual,
  readJsonWithLimit,
  runAnalysisWithCache,
  requireAnalysisAdminAuthorization
} from './index-base.js';

export const handleRequest = handleAi23Request;
export { TRUTH_AUGMENTATION_REPOSITORY_VERSION };
export default worker;
