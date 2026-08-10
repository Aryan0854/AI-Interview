/**
 * Local AI Engine - 100% Offline Resume Analysis
 * Uses heuristic algorithms, NLP patterns, and rule-based systems
 * No external APIs required
 */
export class LocalAIEngine {
  private weakVerbs = [
    'responsible for', 'helped with', 'assisted in', 'worked on', 'involved in',
    'duties included', 'job was', 'tasked with', 'had to', 'needed to'
  ];

  private strongVerbs = {
    leadership: ['led', 'directed', 'orchestrated', 'spearheaded', 'championed', 'mentored'],
    technical: ['engineered', 'architected', 'developed', 'implemented', 'optimized', 'deployed'],
    business: ['increased', 'reduced', 'improved', 'streamlined', 'accelerated', 'generated'],
    creative: ['designed', 'crafted', 'innovated', 'revolutionized', 'transformed']
  };

  private metricPatterns = [
    /\d+%/, /\$[\d,]/, /[\d,]+(?:users?|clients?|customers?|projects?|applications?)/i,
    /[\d,]+(?:months?|years?|weeks?|days?)/i, /team of \d+/i, /[\d,]+(?:increase|decrease|growth)/i
  ];

  private passiveIndicators = [
    /was\s+\w+ed/i, /were\s+\w+ed/i, /has\s+been/i, /have\s+been/i, /had\s+been/i,
    /is\s+\w+ed/i, /are\s+\w+ed/i, /be\s+\w+ed/i
  ];

  private redundantPhrases = [
    "in order to",
    "in an effort to",
    "at this point in time",
    "due to the fact that",
    "for the purpose of",
    "with regards to",
    "in the process of",
  ];

  // Pre-compiled at construction time — avoids re-compiling on every call
  private readonly _bulletStart: RegExp = /^(led|developed|created|managed|designed|implemented|improved|increased)/i;
  private readonly _outcomeWords: RegExp =
    /\b(resulted in|led to|improved|increased|decreased|reduced|saved|generated|achieved)\b/i;
  private readonly _sentSplit: RegExp = /[.!?]+/;
  private readonly _nonWordChars: RegExp = /[^\w\s]/g;
  private readonly _wsSplit: RegExp = /\s+/;
  private readonly _bulletMarker: RegExp =
    /^[\\u2022\\-\\*\u2022\u2023\u2043]\s*/u;

  analyzeResume(text: string, sections: any, jdText?: string): any {
    const words = this.tokenize(text);
    const sentences = this.splitSentences(text);
    const bulletPoints = this.extractBulletPoints(text);

    const baseResult = {
      overallScore: this.calculateOverallScore(text, sections, bulletPoints),
      atsScore: this.calculateATSScore(text, sections),
      technicalScore: this.calculateTechnicalScore(text, sections),
      communicationScore: this.calculateCommunicationScore(sentences, bulletPoints),
      projectQualityScore: this.calculateProjectScore(sections),
      impactScore: this.calculateImpactScore(bulletPoints),
      scores: {
        actionVerbs: this.scoreActionVerbs(bulletPoints),
        measurability: this.scoreMeasurability(bulletPoints),
        formatting: this.scoreFormatting(text, sections),
        clarity: this.scoreClarity(sentences),
        consistency: this.scoreConsistency(text),
        keywordOptimization: this.scoreKeywords(text, sections)
      },
      weaknesses: this.detectWeaknesses(text, sections, bulletPoints),
      strengths: this.detectStrengths(text, sections, bulletPoints),
      readability: this.calculateReadability(sentences, words),
      keywordAnalysis: this.analyzeKeywords(text, sections)
    };

    if (jdText && jdText.trim().length > 0) {
      const techSkills = [
        "javascript", "typescript", "python", "react", "vue", "angular", "node", "express",
        "java", "spring", "c#", ".net", "go", "rust", "php", "docker", "kubernetes", "aws",
        "azure", "gcp", "postgresql", "mongodb", "mysql", "redis", "git", "ci/cd", "html",
        "css", "sass", "webpack", "linux", "bash", "next.js", "nextjs", "tailwind", "tailwindcss",
        "rest api", "graphql", "devops", "machine learning", "ai", "llm"
      ];
      
      const lowerJd = jdText.toLowerCase();
      const jdKeywords = techSkills.filter(skill => lowerJd.includes(skill));
      
      const lowerText = text.toLowerCase();
      const resumeKeywords = techSkills.filter(skill => lowerText.includes(skill));
      
      // Calculate core skill matching score
      let skillMatchScore = 50;
      let matchedSkills: string[] = [];
      if (jdKeywords.length > 0) {
        matchedSkills = jdKeywords.filter(k => resumeKeywords.includes(k));
        skillMatchScore = Math.round((matchedSkills.length / jdKeywords.length) * 100);
      }
      
      // Calculate vocabulary overlap
      const jdWords = this.tokenize(jdText);
      const uniqueJdWords = new Set(jdWords.filter(w => w.length > 4));
      const resumeWords = new Set(words);
      
      let matches = 0;
      uniqueJdWords.forEach(w => {
        if (resumeWords.has(w)) matches++;
      });
      const overlapScore = uniqueJdWords.size > 0 
        ? Math.min(100, Math.round((matches / uniqueJdWords.size) * 100))
        : 50;

      // Weighted matching algorithm
      const jdMatchScore = jdKeywords.length > 0
        ? Math.round((skillMatchScore * 0.65) + (overlapScore * 0.35))
        : overlapScore;

      // Strict thresholds matching industry standards (suitable >= 40)
      const suitability = jdMatchScore >= 40 ? "suitable" : "unsuitable";
      
      const jdMatchRationale = jdKeywords.length > 0
        ? `Matched ${matchedSkills.length} of ${jdKeywords.length} core JD skills (${matchedSkills.join(", ")}). Vocabulary overlap matched ${matches} keywords. Strict calculated compatibility: ${jdMatchScore}%.`
        : `Vocabulary overlap matched ${matches} out of ${uniqueJdWords.size} unique keywords in the Job Description. Calculated match score: ${jdMatchScore}%.`;
      
      return {
        ...baseResult,
        suitability,
        jdMatchScore,
        jdMatchRationale
      };
    }

    return baseResult;
  }

  private calculateOverallScore(text: string, sections: any, bullets: string[]): number {
    const scores = [
      this.scoreActionVerbs(bullets) * 0.20,
      this.scoreMeasurability(bullets) * 0.20,
      this.scoreFormatting(text, sections) * 0.15,
      this.scoreClarity(this.splitSentences(text)) * 0.15,
      this.scoreKeywords(text, sections) * 0.20,
      this.scoreConsistency(text) * 0.10
    ];
    return Math.round(scores.reduce((a: number, b: number) => a + b, 0));
  }

  private scoreActionVerbs(bulletPoints: string[]): number {
    if (bulletPoints.length === 0) return 50;
    let strongCount = 0, totalCount = 0;

    for (const bullet of bulletPoints) {
      const lowerBullet = bullet.toLowerCase();
      const startsWithWeak = this.weakVerbs.some(verb => lowerBullet.startsWith(verb));
      const hasStrongVerb = Object.values(this.strongVerbs).flat().some(verb => 
        lowerBullet.includes(` ${verb} `) || lowerBullet.startsWith(verb + ' ')
      );
      if (!startsWithWeak) totalCount++;
      if (hasStrongVerb) strongCount++;
    }

    return totalCount > 0 ? Math.round((strongCount / Math.max(totalCount, 1)) * 100) : 50;
  }

  private scoreMeasurability(bulletPoints: string[]): number {
    if (bulletPoints.length === 0) return 50;
    const metricCount = bulletPoints.filter(bullet => 
      this.metricPatterns.some(pattern => pattern.test(bullet))
    ).length;
    return Math.round((metricCount / bulletPoints.length) * 100);
  }

  private scoreFormatting(text: string, sections: any): number {
    let score = 100;
    const lines = text.split('\n');
    const blankLines = lines.filter(line => line.trim() === '').length;
    if (blankLines > lines.length * 0.3) score -= 20;

    const expectedSections = ['experience', 'education', 'skills', 'summary'];
    const hasEssentialSections = expectedSections.slice(0, 3).every(section => 
      sections[section] || text.toLowerCase().includes(section)
    );
    if (!hasEssentialSections) score -= 30;

    const longLines = lines.filter(line => line.length > 120).length;
    if (longLines > 5) score -= 15;

    return Math.max(0, score);
  }

  private scoreClarity(sentences: string[]): number {
    if (sentences.length === 0) return 50;
    let issues = 0;
    
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (this.passiveIndicators.some(pattern => pattern.test(lower))) issues++;
      if (this.redundantPhrases.some(phrase => lower.includes(phrase))) issues++;
      if (sentence.length > 200) issues++;
    }

    const ratio = 1 - (issues / (sentences.length * 2));
    return Math.round(ratio * 100);
  }

  private scoreKeywords(text: string, sections: any): number {
    const lowerText = text.toLowerCase();
    const techKeywords = [
      'javascript', 'python', 'react', 'node', 'typescript', 'java', 'aws', 'docker',
      'kubernetes', 'postgresql', 'mongodb', 'git', 'agile', 'scrum', 'ci/cd', 'api',
      'rest', 'graphql', 'html', 'css', 'sql', 'nosql', 'linux', 'devops'
    ];

    const foundKeywords = techKeywords.filter(keyword => lowerText.includes(keyword));
    let score = (foundKeywords.length / techKeywords.length) * 100;
    if (sections.skills) score *= 1.5;
    return Math.min(100, Math.round(score));
  }

  private scoreConsistency(text: string): number {
    let score = 100;
    const datePatterns = [
      /\d{4}\s*-\s*\d{4}/g,
      /\d{2}\/\d{2}\/\d{4}/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/gi
    ];
    
    const formats = datePatterns.filter(p => p.test(text)).length;
    if (formats > 2) score -= 20;
    return score;
  }

  private calculateATSScore(text: string, sections: any): number {
    let score = 40;
    
    if (sections.skills && Object.keys(sections.skills).length > 0) score += 15;
    if (sections.experience && sections.experience.length > 0) score += 20;
    if (sections.education && sections.education.length > 0) score += 15;
    if (sections.summary) score += 10;

    if (sections.personal && (sections.personal.email || sections.personal.phone)) score += 10;

    const lines = text.split('\n');
    
    const longSpaces = text.match(/    /g) || [];
    if (longSpaces.length > 10) score -= 10;

    const trimmedLines = lines.map(l => l.trim()).filter(l => l.length > 10);
    const duplicates = trimmedLines.filter((line, idx) => 
      trimmedLines.indexOf(line) !== idx
    ).length;
    if (duplicates > 2) score -= 15;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateTechnicalScore(text: string, sections: any): number {
    let score = 20;
    const lowerText = text.toLowerCase();

    const techTerms = [
      'algorithm', 'architecture', 'framework', 'library', 'api', 'database',
      'backend', 'frontend', 'full-stack', 'deployment', 'testing', 'security',
      'scalability', 'performance', 'optimization', 'microservices', 'restful',
      'cloud', 'infrastructure', 'pipeline', 'ci/cd', 'containerization', 'orchestration',
      'machine learning', 'analytics', 'data modeling', 'agile', 'scrum'
    ];

    const techCount = techTerms.filter(term => lowerText.includes(term)).length;
    score += Math.min(40, techCount * 3.5);

    const deepTerms = [
      'designed', 'architected', 'implemented', 'built from scratch', 'proprietary',
      'invented', 'patent', 'published', 'open source', 'contributed', 'spearheaded',
      'mentored', 'led'
    ];

    const deepCount = deepTerms.filter(term => lowerText.includes(term)).length;
    score += Math.min(25, deepCount * 5);

    if (sections.skills && sections.skills.technical) {
      const skillCount = sections.skills.technical.length;
      score += Math.min(15, skillCount * 1.5);
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateCommunicationScore(sentences: string[], bullets: string[]): number {
    let score = 100;
    const totalItems = sentences.length + bullets.length;

    const fillerWords = ['basically', 'actually', 'literally', 'very', 'really', 'just', 'stuff', 'things'];
    let fillerCount = 0;
    const allText = sentences.concat(bullets).join(' ').toLowerCase();
    fillerWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const matches = allText.match(regex);
      if (matches) fillerCount += matches.length;
    });
    if (fillerCount > 5) score -= 20;

    const lengths = sentences.map(s => s.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    if (avgLength < 8) score -= 15;
    if (avgLength > 40) score -= 15;

    const sentencesProper = sentences.filter(s => s[0] && s[0] === s[0].toUpperCase()).length;
    const capsRatio = sentencesProper / sentences.length;
    if (capsRatio < 0.9) score -= 20;

    return Math.max(0, score);
  }

  private calculateProjectScore(sections: any): number {
    if (!sections.projects || sections.projects.length === 0) return 30;

    let score = 50;
    score += 15;

    sections.projects.forEach((project: any) => {
      const desc = project.description || '';
      const bullets = project.bulletPoints || [];
      
      if (bullets.some((b: string) => 
        b.toLowerCase().includes('used ') || b.toLowerCase().includes('technology ')
      )) {
        score += 5;
      }
      
      if (bullets.some((b: string) => this.metricPatterns.some(p => p.test(b)))) {
        score += 10;
      }
    });

    return Math.min(100, score);
  }

  private calculateImpactScore(bulletPoints: string[]): number {
    if (bulletPoints.length === 0) return 30;

    let totalImpact = 0;

    for (const bullet of bulletPoints) {
      const lower = bullet.toLowerCase();
      let bulletScore = 20;
      
      if (this.metricPatterns.some(p => p.test(bullet))) bulletScore += 35;
      
      if (Object.values(this.strongVerbs).flat().some(verb => 
        lower.startsWith(verb) || lower.includes(` ${verb} `)
      )) {
        bulletScore += 25;
      }
      
      const outcomes = ['resulted in', 'led to', 'improved', 'increased', 'decreased', 'reduced', 'saved', 'generated', 'achieved'];
      if (outcomes.some(o => lower.includes(o))) {
        bulletScore += 20;
      }

      totalImpact += Math.min(100, bulletScore);
    }

    return Math.max(0, Math.min(100, Math.round(totalImpact / bulletPoints.length)));
  }

  detectWeaknesses(text: string, sections: any, bullets: string[]): any[] {
    const weaknesses: any[] = [];

    const weakVerbsFound: string[] = [];
    const missingMetricsFound: string[] = [];

    bullets.forEach((bullet, idx) => {
      const lower = bullet.toLowerCase();
      if (this.weakVerbs.some(verb => lower.startsWith(verb))) {
        weakVerbsFound.push(bullet);
      }
      if (!this.metricPatterns.some(p => p.test(bullet))) {
        missingMetricsFound.push(bullet);
      }
      if (bullet.length > 200) {
        weaknesses.push({
          category: 'format',
          severity: 'medium',
          location: `Bullet ${idx + 1}`,
          description: 'Bullet point too long (>200 chars)',
          suggestion: 'Split into two focused bullet points',
          examples: [bullet.substring(0, 100) + '...']
        });
      }
    });

    if (weakVerbsFound.length > 0) {
      weaknesses.push({
        category: 'communication',
        severity: weakVerbsFound.length > 3 ? 'high' : 'medium',
        location: 'Experience Section',
        description: `Found ${weakVerbsFound.length} bullet point(s) starting with weak or passive verbs.`,
        suggestion: 'Start bullet points with strong action verbs (e.g., led, developed, increased) to show ownership.',
        examples: weakVerbsFound.slice(0, 2)
      });
    }

    if (missingMetricsFound.length > 0) {
      weaknesses.push({
        category: 'impact',
        severity: missingMetricsFound.length > 3 ? 'high' : 'medium',
        location: 'Experience Section',
        description: `Found ${missingMetricsFound.length} bullet point(s) lacking quantifiable metrics.`,
        suggestion: 'Quantify your impact using numbers, percentages, or dollar amounts to make achievements concrete.',
        examples: missingMetricsFound.slice(0, 2)
      });
    }

    if (!sections.summary && !text.toLowerCase().includes('summary')) {
      weaknesses.push({
        category: 'format',
        severity: 'high',
        location: 'Top of resume',
        description: 'Missing professional summary',
        suggestion: 'Add 3-4 line professional summary highlighting key achievements',
        examples: []
      });
    }

    if (sections.personal) {
      if (!sections.personal.email && !sections.personal.phone) {
         weaknesses.push({
          category: 'format',
          severity: 'high',
          location: 'Header',
          description: 'Missing critical contact information (email or phone)',
          suggestion: 'Ensure your email and phone number are clearly visible at the top',
          examples: []
        });
      }
      if (!sections.personal.linkedin && !sections.personal.github) {
         weaknesses.push({
          category: 'format',
          severity: 'medium',
          location: 'Header',
          description: 'Missing professional links',
          suggestion: 'Add a link to your LinkedIn profile or portfolio',
          examples: []
        });
      }
    }

    const grandioseWords = ['expert in', 'mastered', 'guru', 'ninja', 'visionary', 'world-class'];
    const lowerText = text.toLowerCase();
    grandioseWords.forEach(word => {
      if (lowerText.includes(word)) {
        weaknesses.push({
          category: 'content',
          severity: 'medium',
          location: 'General',
          description: `Use of grandiose or subjective terms ('${word}')`,
          suggestion: 'Replace subjective claims with objective achievements and metrics',
          examples: [word]
        });
      }
    });

    return weaknesses;
  }

  detectStrengths(text: string, sections: any, bullets: string[]): any[] {
    const strengths: any[] = [];
    const lowerText = text.toLowerCase();
    
    const strongVerbCount = bullets.filter(b => 
      Object.values(this.strongVerbs).flat().some(v => b.toLowerCase().includes(v))
    ).length;

    if (strongVerbCount > bullets.length * 0.4) {
      strengths.push({
        category: "Communication",
        description: "Uses strong action verbs effectively to describe responsibilities.",
        impact: "medium"
      });
    }

    const metricCount = bullets.filter(b => this.metricPatterns.some(p => p.test(b))).length;
    if (metricCount > bullets.length * 0.3) {
      strengths.push({
        category: "Impact",
        description: "Exceptional use of quantifiable metrics across professional experiences.",
        impact: "high"
      });
    }

    const techTerms = ['framework', 'api', 'database', 'backend', 'frontend', 'cloud', 'pipeline', 'deployment', 'ai', 'ml', 'machine learning', 'llm', 'rag'];
    const techDensity = techTerms.filter(t => lowerText.includes(t)).length;
    if (techDensity >= 4) {
      strengths.push({
        category: "Technical",
        description: "Deep expertise in modern technical stacks, tools, and systems.",
        impact: "high"
      });
    }

    const leadershipTerms = ['led', 'directed', 'managed', 'orchestrated', 'spearheaded', 'mentored', 'coordinated'];
    const leadershipCount = leadershipTerms.filter(t => lowerText.includes(t)).length;
    if (leadershipCount >= 2) {
      strengths.push({
        category: "Leadership",
        description: "Proven ability to lead projects, guide teams, and coordinate delivery.",
        impact: "medium"
      });
    }

    if (strengths.length === 0) {
      strengths.push({
        category: "Structure",
        description: "Clear and standard resume formatting with solid sections.",
        impact: "low"
      });
    }

    return strengths;
  }

  calculateReadability(sentences: string[], words: string[]): any {
    if (sentences.length === 0 || words.length === 0) {
      return { fleschReadingEase: 50, averageSentenceLength: 15, passiveVoiceCount: 0, jargonCount: 0, readingTime: 1 };
    }

    const avgSentenceLength = words.length / sentences.length;
    const avgSyllablesPerWord = words.reduce((acc, word) => acc + this.estimateSyllables(word), 0) / words.length;
    const flesch = 206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord);
    
    let passiveCount = 0;
    sentences.forEach(s => {
      if (this.passiveIndicators.some(p => p.test(s))) passiveCount++;
    });

    const buzzwords = ['synergy', 'leverage', 'holistic', 'paradigm', 'streamline', 'bandwidth'];
    const jargonCount = words.filter(w => buzzwords.includes(w.toLowerCase())).length;

    return {
      fleschReadingEase: Math.round(Math.max(0, Math.min(100, flesch))),
      averageSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      passiveVoiceCount: passiveCount,
      jargonCount,
      readingTime: Math.ceil(words.length / 200)
    };
  }

  analyzeKeywords(text: string, sections: any): any {
    const lowerText = text.toLowerCase();
    
    const industryKeywords = {
      software: ['javascript', 'python', 'react', 'node', 'api', 'database', 'git', 'agile'],
      data: ['sql', 'python', 'analytics', 'visualization', 'etl', 'warehouse', 'tableau'],
      design: ['ui', 'ux', 'figma', 'sketch', 'prototyping', 'wireframe', 'responsive']
    };

    const matchedKeywords: string[] = [];
    const missingKeywords: string[] = [];
    const suggestedKeywords: string[] = [];

    Object.entries(industryKeywords).forEach(([industry, keywords]) => {
      keywords.forEach(keyword => {
        if (lowerText.includes(keyword)) {
          matchedKeywords.push(keyword);
        } else {
          missingKeywords.push(keyword);
        }
      });
    });

    const jobTitleKeywords = ['full stack', 'frontend', 'backend', 'devops', 'manager'];
    const detectedRole = jobTitleKeywords.find(title => lowerText.includes(title));
    if (detectedRole) {
      suggestedKeywords.push(detectedRole, 'collaboration', 'problem-solving');
    }

    return {
      matchedKeywords: [...new Set(matchedKeywords)],
      missingKeywords: [...new Set(missingKeywords)].slice(0, 10),
      overusedKeywords: this.detectOverusedWords(text),
      industryRelevance: Math.round((matchedKeywords.length / (matchedKeywords.length + missingKeywords.length)) * 100),
      suggestedKeywords
    };
  }

  private detectOverusedWords(text: string): string[] {
    const words = this.tokenize(text.toLowerCase());
    const wordCounts: Record<string, number> = {};
    
    words.forEach(word => {
      if (word.length > 4) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });

    return Object.entries(wordCounts)
      .filter(([_, count]) => count >= 3)
      .map(([word]) => word)
      .slice(0, 5);
  }

  enhanceBulletPoint(bullet: string, context: string): string {
    const lowerBullet = bullet.toLowerCase().trim();
    const firstWord = lowerBullet.split(' ')[0];

    const weakMatch = this.weakVerbs.find(v => lowerBullet.startsWith(v));
    if (weakMatch) {
      const rest = bullet.slice(weakMatch.length).trim();
      const replacement = this.suggestStrongVerb(rest, context);
      if (replacement) {
        return `${replacement} ${rest}`;
      }
    }

    if (!this.metricPatterns.some(p => p.test(bullet))) {
      return this.addSuggestedMetrics(bullet, context);
    }

    if (bullet.length > 200) {
      return this.condenseBullet(bullet);
    }

    if (this.isGenericTask(bullet)) {
      return this.makeOutcomeFocused(bullet);
    }

    return bullet;
  }

  private suggestStrongVerb(rest: string, context: string): string {
    const lowerRest = rest.toLowerCase();
    
    if (lowerRest.includes('team') || lowerRest.includes('group')) return 'led';
    if (lowerRest.includes('code') || lowerRest.includes('develop') || lowerRest.includes('build')) return 'engineered';
    if (lowerRest.includes('improve') || lowerRest.includes('optimize')) return 'optimized';
    if (lowerRest.includes('design') || lowerRest.includes('create')) return 'designed';
    if (lowerRest.includes('manage') || lowerRest.includes('oversee')) return 'managed';
    
    return 'spearheaded';
  }

  private addSuggestedMetrics(bullet: string, context: string): string {
    const lower = bullet.toLowerCase();
    
    if (lower.includes('team')) {
      return bullet + ' resulting in 40% faster delivery';
    }
    if (lower.includes('increase') || lower.includes('grow')) {
      return bullet + ' by 35%';
    }
    if (lower.includes('reduce') || lower.includes('decrease')) {
      return bullet + ' by 25%';
    }
    if (lower.includes('develop') || lower.includes('build')) {
      return bullet + ', serving 10K+ users';
    }
    if (lower.includes('process') || lower.includes('system')) {
      return bullet + ' saving 20 hours/week';
    }
    
    return bullet;
  }

  private condenseBullet(bullet: string): string {
    const words = bullet.split(' ');
    if (words.length <= 15) return bullet;
    
    const fillers = ['in order to', 'with the goal of', 'for the purpose of', 'as part of'];
    let result = bullet;
    fillers.forEach(filler => {
      result = result.replace(new RegExp(filler, 'gi'), 'to');
    });
    
    return result;
  }

  private isGenericTask(bullet: string): boolean {
    const genericPhrases = [
      'worked on', 'helped with', 'participated in', 'involved with',
      'assisted', 'contributed to'
    ];
    return genericPhrases.some(phrase => bullet.toLowerCase().includes(phrase));
  }

  private makeOutcomeFocused(bullet: string): string {
    const lower = bullet.toLowerCase();
    const improvements: Record<string, string> = {
      'worked on': 'delivered',
      'helped with': 'contributed to',
      'participated in': 'played key role in',
      'assisted': 'supported',
      'contributed to': 'drove'
    };

    Object.entries(improvements).forEach(([weak, strong]) => {
      if (lower.includes(weak)) {
        bullet = bullet.replace(new RegExp(weak, 'gi'), strong);
      }
    });

    return bullet;
  }

  rewriteSummary(summary: string): string {
    const sentences = this.splitSentences(summary);
    
    if (sentences.length > 4) {
      const impactful = sentences.filter(s => 
        this.metricPatterns.some(p => p.test(s)) ||
        Object.values(this.strongVerbs).flat().some(v => s.toLowerCase().includes(v))
      );
      return impactful.slice(0, 3).join('. ') + '.';
    }
    
    return summary;
  }

  generateSuggestions(analysis: any): any[] {
    const suggestions: any[] = [];

    if (analysis.scores.measurability < 50) {
      suggestions.push({
        type: 'modify',
        section: 'experience',
        priority: 'high',
        description: 'Add quantifiable metrics to all experience bullets',
        rationale: 'Resumes with metrics get 40% more interviews'
      });
    }

    if (analysis.scores.actionVerbs < 60) {
      suggestions.push({
        type: 'modify',
        section: 'experience',
        priority: 'high',
        description: 'Replace weak verbs (responsible for, helped) with strong ones (led, developed)',
        rationale: 'Strong verbs increase perceived competence by 34%'
      });
    }

    if (analysis.projectQualityScore < 60) {
      suggestions.push({
        type: 'add',
        section: 'projects',
        priority: 'medium',
        description: 'Add a projects section showcasing hands-on work',
        rationale: 'Projects demonstrate practical skills'
      });
    }

    return suggestions;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(this._nonWordChars, "")
      .split(this._wsSplit)
      .filter((w: string) => w.length > 0);
  }

  private splitSentences(text: string): string[] {
    return text.split(this._sentSplit).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }

  private extractBulletPoints(text: string): string[] {
    const lines = text.split('\n');
    return lines.filter(line => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('•') ||
        trimmed.startsWith('-') ||
        trimmed.startsWith('*') ||
        this._bulletStart.test(trimmed)
      );
    }).map(l => l.replace(this._bulletMarker, '').trim());
  }

  private estimateSyllables(word: string): number {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    if (word.match(/^[aeiou]+/)) return 2;
    if (word.match(/[aeiou]{2,}/)) return 2;
    return Math.ceil(word.length / 2.5);
  }
}

export const localEngine = new LocalAIEngine();
