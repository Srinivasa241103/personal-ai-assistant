import {DocumentRepository} from './documentRepository.js';
import {CredentialRepository} from './credentialRepository.js';
import {SyncLogRepository} from './syncLogsRepository.js';

export const documentRepository = new DocumentRepository();
export const credentialRepository = new CredentialRepository();
export const syncLogRepository = new SyncLogRepository();
export {
    DocumentRepository,
    CredentialRepository,
    SyncLogRepository
};
