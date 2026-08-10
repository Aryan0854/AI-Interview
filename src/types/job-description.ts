export interface JobDescription {
  id: string;
  jdText: string;
  rmEmail: string;
  fileName: string;
  createdAt: string;
  duplicateIds?: string[];
}
