export type QtsResumeSectionItem = {
  heading?: string;
  subheading?: string;
  dateRange?: string;
  bullets?: string[];
};

export type QtsResumeSection = {
  title?: string;
  items?: QtsResumeSectionItem[];
};

export type QtsResumeDocument = {
  candidate: {
    fullName: string;
    email: string;
    phone?: string;
    linkedinUrl?: string;
    location?: string;
    headline?: string;
  };
  targetRole: string;
  targetCompany?: string;
  targetJobsite?: string;
  summary?: string;
  sections: QtsResumeSection[];
};

export type QtsCoverLetterDocument = {
  date?: string;
  salutation?: string;
  bodyParagraphs: string[];
  closing?: string;
};
