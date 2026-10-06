/**
 * The controlled schema that application form fields are mapped onto.
 *
 * Field mapping (heuristic now, AI-assisted later) classifies every detected
 * form field into one of these keys, or into "unknown". Keeping the schema
 * closed is what makes low-confidence mappings detectable.
 */
export const PROFILE_FIELD_KEYS = [
  "masterProfile.firstName",
  "masterProfile.lastName",
  "masterProfile.fullName",
  "masterProfile.preferredName",
  "masterProfile.email",
  "masterProfile.phone",
  "masterProfile.addressLine1",
  "masterProfile.addressLine2",
  "masterProfile.city",
  "masterProfile.state",
  "masterProfile.postalCode",
  "masterProfile.country",
  "masterProfile.linkedinUrl",
  "masterProfile.portfolioUrl",
  "masterProfile.websiteUrl",
  "masterProfile.githubUrl",
  "masterProfile.currentTitle",
  "masterProfile.currentCompany",
  "masterProfile.yearsExperience",
  "masterProfile.summary",
  "education.school",
  "education.degree",
  "education.major",
  "education.gpa",
  "education.graduationDate",
  "documents.resume",
  "documents.coverLetter",
  "answer.library",
  "unknown",
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/** Label variants known to mean the same profile field. Used before any AI call. */
export const FIELD_LABEL_SYNONYMS: Partial<Record<ProfileFieldKey, string[]>> = {
  "masterProfile.firstName": ["first name", "given name", "forename", "legal first name"],
  "masterProfile.lastName": ["last name", "surname", "family name", "legal last name"],
  "masterProfile.fullName": ["full name", "name", "legal name", "your name"],
  "masterProfile.preferredName": ["preferred name", "nickname", "preferred first name"],
  "masterProfile.email": ["email", "email address", "e-mail", "e-mail address", "your email", "confirm email", "confirm your email", "confirm email address", "re-enter email", "re-enter email address", "verify email"],
  "masterProfile.phone": ["phone", "phone number", "mobile", "mobile number", "mobile phone", "cell", "cell phone", "telephone", "telephone number", "contact number"],
  "masterProfile.addressLine1": ["address", "street address", "address line 1", "street"],
  "masterProfile.addressLine2": ["address line 2", "apartment", "suite", "apt"],
  "masterProfile.city": ["city", "town", "city/town", "location", "location city", "current location", "city of residence"],
  "masterProfile.state": ["state", "province", "region", "state/province"],
  "masterProfile.postalCode": ["zip", "zip code", "postal code", "postcode"],
  "masterProfile.country": ["country", "country of residence"],
  "masterProfile.linkedinUrl": ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url"],
  "masterProfile.portfolioUrl": ["portfolio", "portfolio url", "portfolio link"],
  "masterProfile.websiteUrl": ["website", "personal website", "website url", "other website"],
  "masterProfile.githubUrl": ["github", "github url", "github profile"],
  "masterProfile.currentTitle": ["current title", "current job title", "current position"],
  "masterProfile.currentCompany": ["current company", "current employer", "employer"],
  "masterProfile.yearsExperience": ["years of experience", "total years of experience", "how many years of experience"],
  "documents.resume": ["resume", "cv", "resume/cv", "upload resume"],
  "documents.coverLetter": ["cover letter", "upload cover letter"],
};
