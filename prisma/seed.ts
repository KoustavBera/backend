import { PrismaClient, UserRoleType, ResourceCategory, ResourceFormat, GalleryCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

const CLASSES = ROMAN.map((roman, i) => {
  const number = i + 1;
  const board =
    number <= 4
      ? "Primary"
      : number <= 8
      ? "Upper Primary"
      : number <= 10
      ? "Secondary"
      : "Higher Secondary";
  return {
    id: `class-${number}`,
    number,
    roman,
    label: `Class ${roman}`,
    board,
    sortOrder: number,
  };
});

type SubjectSeed = { slug: string; name: string; nameBn?: string; icon: string };

const BANGLA: SubjectSeed = { slug: "bangla", name: "Bengali", nameBn: "বাংলা", icon: "languages" };
const ENGLISH: SubjectSeed = { slug: "english", name: "English", nameBn: "ইংরেজি", icon: "book" };
const MATH: SubjectSeed = { slug: "mathematics", name: "Mathematics", nameBn: "গণিত", icon: "calculator" };
const PHYS_SCI: SubjectSeed = { slug: "physical-science", name: "Physical Science", nameBn: "ভৌতবিজ্ঞান", icon: "atom" };
const LIFE_SCI: SubjectSeed = { slug: "life-science", name: "Life Science", nameBn: "জীবনবিজ্ঞান", icon: "dna" };
const HISTORY: SubjectSeed = { slug: "history", name: "History", nameBn: "ইতিহাস", icon: "landmark" };
const GEOGRAPHY: SubjectSeed = { slug: "geography", name: "Geography", nameBn: "ভূগোল", icon: "globe" };

const SEEDS_BY_LEVEL: Record<string, SubjectSeed[]> = {
  primary: [
    BANGLA,
    ENGLISH,
    MATH,
    { slug: "environment", name: "Environment", nameBn: "আমাদের পরিবেশ", icon: "leaf" },
  ],
  5: [
    BANGLA,
    ENGLISH,
    MATH,
    { slug: "environment-science", name: "Environment & Science", nameBn: "পরিবেশ ও বিজ্ঞান", icon: "leaf" },
    HISTORY,
    GEOGRAPHY,
  ],
  secondary: [BANGLA, ENGLISH, MATH, PHYS_SCI, LIFE_SCI, HISTORY, GEOGRAPHY],
  higher: [
    BANGLA,
    ENGLISH,
    { slug: "physics", name: "Physics", nameBn: "পদার্থবিদ্যা", icon: "atom" },
    { slug: "chemistry", name: "Chemistry", nameBn: "রসায়ন", icon: "flask" },
    MATH,
    { slug: "biology", name: "Biology", nameBn: "জীববিদ্যা", icon: "dna" },
    { slug: "computer-science", name: "Computer Science", nameBn: "কম্পিউটার বিজ্ঞান", icon: "cpu" },
    { slug: "economics", name: "Economics", nameBn: "অর্থনীতি", icon: "trending" },
    HISTORY,
    GEOGRAPHY,
    { slug: "political-science", name: "Political Science", nameBn: "রাষ্ট্রবিজ্ঞান", icon: "scale" },
    { slug: "philosophy", name: "Philosophy", nameBn: "দর্শন", icon: "lightbulb" },
    { slug: "sociology", name: "Sociology", nameBn: "সমাজবিজ্ঞান", icon: "users" },
  ],
};

const subjectsForClass = (classNumber: number): SubjectSeed[] => {
  if (classNumber <= 4) return SEEDS_BY_LEVEL.primary;
  if (classNumber === 5) return SEEDS_BY_LEVEL[5];
  if (classNumber <= 10) return SEEDS_BY_LEVEL.secondary;
  return SEEDS_BY_LEVEL.higher;
};

const SAMPLE_YOUTUBE = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

async function main() {
  console.log("🌱 Starting database seeding...");

  // 1. Seed Classes
  console.log("Seeding classes...");
  for (const cls of CLASSES) {
    await prisma.class.upsert({
      where: { id: cls.id },
      update: {
        number: cls.number,
        roman: cls.roman,
        label: cls.label,
        board: cls.board,
        sortOrder: cls.sortOrder,
      },
      create: cls,
    });
  }
  console.log(`✅ Seeded ${CLASSES.length} classes.`);

  // 2. Default password hash: Password123!
  const defaultPasswordHash = await bcrypt.hash("Password123!", 10);

  // 3. Seed Admin
  const adminEmail = "admin@durgapurhighschool.in";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { displayName: "Headmaster Admin", isActive: true },
    create: {
      email: adminEmail,
      passwordHash: defaultPasswordHash,
      displayName: "Headmaster Admin",
      isActive: true,
      roles: {
        create: [{ role: UserRoleType.admin }, { role: UserRoleType.teacher }],
      },
    },
    include: { roles: true },
  });
  console.log(`✅ Seeded Admin: ${admin.email}`);

  // 4. Seed Teacher 1 (Secondary: IX & X)
  const teacher1Email = "anirban.banerjee@durgapurhighschool.in";
  const teacher1 = await prisma.user.upsert({
    where: { email: teacher1Email },
    update: { displayName: "Dr. Anirban Banerjee (Physical Science)", isActive: true },
    create: {
      email: teacher1Email,
      passwordHash: defaultPasswordHash,
      displayName: "Dr. Anirban Banerjee (Physical Science)",
      isActive: true,
      roles: { create: [{ role: UserRoleType.teacher }] },
      classAssignments: { create: [{ classId: "class-9" }, { classId: "class-10" }] },
    },
  });

  await prisma.userClassAssignment.upsert({
    where: { userId_classId: { userId: teacher1.id, classId: "class-9" } },
    update: {},
    create: { userId: teacher1.id, classId: "class-9" },
  });
  await prisma.userClassAssignment.upsert({
    where: { userId_classId: { userId: teacher1.id, classId: "class-10" } },
    update: {},
    create: { userId: teacher1.id, classId: "class-10" },
  });
  console.log(`✅ Seeded Teacher 1: ${teacher1.email}`);

  // 5. Seed Teacher 2 (Higher Secondary: XI & XII)
  const teacher2Email = "mousumi.roy@durgapurhighschool.in";
  const teacher2 = await prisma.user.upsert({
    where: { email: teacher2Email },
    update: { displayName: "Mousumi Roy (Mathematics)", isActive: true },
    create: {
      email: teacher2Email,
      passwordHash: defaultPasswordHash,
      displayName: "Mousumi Roy (Mathematics)",
      isActive: true,
      roles: { create: [{ role: UserRoleType.teacher }] },
      classAssignments: { create: [{ classId: "class-11" }, { classId: "class-12" }] },
    },
  });

  await prisma.userClassAssignment.upsert({
    where: { userId_classId: { userId: teacher2.id, classId: "class-11" } },
    update: {},
    create: { userId: teacher2.id, classId: "class-11" },
  });
  await prisma.userClassAssignment.upsert({
    where: { userId_classId: { userId: teacher2.id, classId: "class-12" } },
    update: {},
    create: { userId: teacher2.id, classId: "class-12" },
  });
  console.log(`✅ Seeded Teacher 2: ${teacher2.email}`);

  // 6. Seed Subjects across all classes
  console.log("Seeding subjects and sample resources...");
  let subjectCount = 0;
  let resourceCount = 0;

  for (const cls of CLASSES) {
    const seeds = subjectsForClass(cls.number);

    for (const s of seeds) {
      const subject = await prisma.subject.upsert({
        where: { classId_slug: { classId: cls.id, slug: s.slug } },
        update: {
          name: s.name,
          nameBn: s.nameBn,
          icon: s.icon,
          isActive: true,
        },
        create: {
          classId: cls.id,
          slug: s.slug,
          name: s.name,
          nameBn: s.nameBn,
          icon: s.icon,
          createdBy: admin.id,
        },
      });
      subjectCount++;

      // Seed resources only for Class IX and X to match mock UI data
      if (cls.number === 9 || cls.number === 10) {
        // Delete previous sample resources for clean idempotent re-seed
        await prisma.resource.deleteMany({
          where: { subjectId: subject.id },
        });

        const samples = [
          {
            category: ResourceCategory.video,
            format: ResourceFormat.youtube,
            title: "Chapter 1 — Full Lesson",
            chapter: "Chapter 1",
            youtubeUrl: SAMPLE_YOUTUBE,
            objectKey: null,
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.video,
            format: ResourceFormat.youtube,
            title: "Chapter 2 — Worked Examples",
            chapter: "Chapter 2",
            youtubeUrl: SAMPLE_YOUTUBE,
            objectKey: null,
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.notes,
            format: ResourceFormat.pdf,
            title: "Handwritten Notes — Chapter 1",
            chapter: "Chapter 1",
            youtubeUrl: null,
            objectKey: "sample.pdf",
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.notes,
            format: ResourceFormat.image,
            title: "Board Work — Key Points",
            chapter: "Chapter 2",
            youtubeUrl: null,
            objectKey: "outside_1.jpeg",
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.book,
            format: ResourceFormat.pdf,
            title: "Prescribed Textbook",
            chapter: null,
            youtubeUrl: null,
            objectKey: "sample.pdf",
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.pyq,
            format: ResourceFormat.pdf,
            title: "Question Paper 2025",
            chapter: null,
            youtubeUrl: null,
            objectKey: "sample.pdf",
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
          {
            category: ResourceCategory.pyq,
            format: ResourceFormat.pdf,
            title: "Question Paper 2024",
            chapter: null,
            youtubeUrl: null,
            objectKey: "sample.pdf",
            academicYear: "2025-26",
            isPublished: true,
            uploadedBy: teacher1.id,
          },
        ];

        for (const r of samples) {
          await prisma.resource.create({
            data: {
              subjectId: subject.id,
              ...r,
            },
          });
          resourceCount++;
        }
      }
    }
  }

  console.log(`✅ Seeded ${subjectCount} subjects and ${resourceCount} sample resources.`);

  // 7. Seed News Articles
  console.log("Seeding news articles...");
  const NEWS_ARTICLES = [
    {
      slug: "cbse-class-x-results-100-percent",
      tag: "Achievement",
      category: "Press release",
      title: "Class X students secure 100% first-division record in CBSE board examinations",
      date: "30 Sep 2026",
      publishedAt: new Date("2026-09-30T04:00:00Z"),
      location: "Durgapur",
      image: "/photos/classroom_1.jpg",
      imageCaption: "Academic excellence assembly celebrating the Class X batch merit achievers.",
      desc: "Students of Durgapur Public School have recorded an exceptional 100% first-division pass rate in the CBSE Board examinations, with more than thirty-five students securing percentiles above 95%.",
      lead: "Durgapur, 30 September 2026: Durgapur Public School today celebrates an unprecedented academic milestone as the entire Class X cohort achieved a 100% first-division qualification in the Central Board of Secondary Education (CBSE) examinations.",
      body: [
        "Out of 142 candidates who appeared for the secondary school examination, 38 students attained overall aggregate scores exceeding 95%, with perfect 100-mark scores recorded across Mathematics, Computer Applications, and General Science disciplines.",
        "The school administration attributes these standout outcomes to holistic diagnostic mentorship, consistent modular revision cycles, and state-of-the-art interactive digital science laboratories initiated over the past three academic sessions.",
        "Special remedial support programs instituted for students requiring additional conceptual reinforcement contributed significantly to bridging academic gaps, ensuring every enrolled candidate succeeded with distinction.",
      ],
      quote: {
        text: "Our students have demonstrated extraordinary resilience, curiosity, and discipline. This accomplishment reflects not merely test results, but a deep commitment to intellectual rigor and supportive teaching.",
        author: "Dr. Aniruddha Roy",
        role: "Principal, Durgapur Public School",
      },
      author: {
        name: "Academic Affairs Bureau",
        role: "Office of the Principal",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "20260930 CBSE Class X Official Result Gazette Summary (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 1400000n,
        },
        {
          title: "High-Resolution Felicitations Ceremony Photos (zip)",
          url: "/sample.pdf",
          type: "zip",
          sizeBytes: 18200000n,
        },
      ],
      relatedSlugs: [
        "ai-robotics-innovation-lab-launch",
        "inter-school-science-fair-commences",
        "faculty-delegation-national-educator-summit",
        "silver-jubilee-annual-day",
      ],
    },
    {
      slug: "inter-school-science-fair-commences",
      tag: "Event",
      category: "Press release",
      title: "Inter-school science fair commences with 40+ participating institutions",
      date: "30 Sep 2026",
      publishedAt: new Date("2026-09-30T05:30:00Z"),
      location: "Durgapur",
      image: "/photos/science.jpg",
      imageCaption: "Students exhibiting practical models at the campus science pavilion.",
      desc: "The annual Inter-School Science Fair commenced on campus today with over forty prestigious schools presenting innovative working models spanning renewable energy, robotics, and applied biotechnology.",
      lead: "Durgapur, 30 September 2026: More than forty prominent schools from across the region assembled at the Durgapur Public School auditorium and science wings for the inaugural session of the 2026 Inter-School Science & Innovation Conclave.",
      body: [
        "The two-day exhibition features over 120 competitive project exhibits curated by senior secondary students. Themes explore contemporary scientific imperatives including climate-adaptive agriculture, localized micro-grid electrical systems, and machine-learning diagnostic tools.",
        "An eminent panel of research scientists and university professors from regional institutes evaluated demonstrations across primary, junior, and senior categories.",
        "Members of the public, fellow educators, and parents are invited to inspect the exhibitions during visiting sessions scheduled across the next forty-eight hours.",
      ],
      quote: {
        text: "Encouraging scientific temperament at an early age provides youngsters with the confidence to tackle real-world environmental and technological challenges.",
        author: "Prof. S. Mukherjee",
        role: "Chief Guest & Senior Scientist",
      },
      author: {
        name: "Science & Innovation Council",
        role: "Event Secretariat",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "2026 Science Conclave Program Schedule & Exhibit Catalogue (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 2100000n,
        },
        {
          title: "Exhibitor Guidelines & Evaluation Criteria (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 820000n,
        },
      ],
      relatedSlugs: [
        "ai-robotics-innovation-lab-launch",
        "cbse-class-x-results-100-percent",
        "faculty-delegation-national-educator-summit",
        "varsity-sports-district-championship",
      ],
    },
    {
      slug: "ai-robotics-innovation-lab-launch",
      tag: "Campus",
      category: "Press release",
      title: "DPS launches state-of-the-art AI & Robotics Innovation Lab for senior students",
      date: "21 Sep 2026",
      publishedAt: new Date("2026-09-21T04:45:00Z"),
      location: "Durgapur",
      image: "/photos/outside_2.jpg",
      imageCaption: "Front exterior facing the newly commissioned STEM & Robotics Annex.",
      desc: "Durgapur Public School today announces the launch of its new Robotics & Artificial Intelligence Innovation Center, equipped with precision sensors, 3D prototyping tools, and IoT automation workstations.",
      lead: "Durgapur, 21 September 2026: Durgapur Public School has formally inaugurated its cutting-edge AI & Robotics Innovation Laboratory, inaugurating a multi-disciplinary space dedicated to hands-on STEM education and embedded computing.",
      body: [
        "The new facility includes industrial-grade 3D printers, microcontroller kits, sensory instrumentation, and dedicated compute terminals configured with Python and machine-learning frameworks.",
        "Students from Class VI through XII will undergo structured project-based modules integrating mathematics, algorithm design, and applied physics.",
        "The infrastructure investment aims to provide school students with early technical fluency, equipping them for upcoming university admissions in advanced engineering and scientific disciplines.",
      ],
      quote: {
        text: "Theoretical comprehension reaches its highest value when students can assemble, test, and program physical systems with their own hands.",
        author: "Sri Bikash Das",
        role: "Head of Computer Science & Robotics",
      },
      author: {
        name: "DPS Communications Team",
        role: "Press Office",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "Innovation Lab Specifications & Equipment Brief (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 1800000n,
        },
        {
          title: "Laboratory Press Assets & Facility Photos (zip)",
          url: "/sample.pdf",
          type: "zip",
          sizeBytes: 14500000n,
        },
      ],
      relatedSlugs: [
        "inter-school-science-fair-commences",
        "cbse-class-x-results-100-percent",
        "silver-jubilee-annual-day",
        "faculty-delegation-national-educator-summit",
      ],
    },
    {
      slug: "varsity-sports-district-championship",
      tag: "Sports",
      category: "Press release",
      title: "Varsity football & athletics contingent clinches District Championship trophy",
      date: "10 Sep 2026",
      publishedAt: new Date("2026-09-10T11:15:00Z"),
      location: "Durgapur",
      image: "/photos/group_1.jpg",
      imageCaption: "Varsity contingent with the championship cup after the final tournament match.",
      desc: "In accordance with tournament standards, our varsity sports contingent produced an unbeaten championship run, lifting the district school sports trophy for the third successive academic year.",
      lead: "Durgapur, 10 September 2026: The varsity sports delegation of Durgapur Public School delivered an exemplary performance at the Purba Medinipur Inter-District School Athletics & Football Championship, claiming overall championship honors.",
      body: [
        "The school football team maintained an unblemished clean sheet throughout the knockout stages, concluding with a dramatic 2-0 victory in the tournament final against the host academy.",
        "In track and field events, DPS student athletes bagged six gold medals across the 100m sprint, 4x100m relay, long jump, and shot put disciplines.",
        "Special commendations were awarded to sports coaches and physical education faculty who maintained structured morning conditioning regimens throughout the past six months.",
      ],
      quote: {
        text: "Sports instill humility in victory and grit in perseverance. Our athletes showed tremendous teamwork and character on the pitch.",
        author: "Sri R. Chatterjee",
        role: "Director of Physical Education",
      },
      author: {
        name: "Sports Information Desk",
        role: "Athletics Department",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "District Championship Final Scorecard & Medal Tally (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 950000n,
        },
        {
          title: "Tournament Photo Gallery & Team Roster (zip)",
          url: "/sample.pdf",
          type: "zip",
          sizeBytes: 11200000n,
        },
      ],
      relatedSlugs: [
        "silver-jubilee-annual-day",
        "cbse-class-x-results-100-percent",
        "inter-school-science-fair-commences",
        "ai-robotics-innovation-lab-launch",
      ],
    },
    {
      slug: "silver-jubilee-annual-day",
      tag: "Celebration",
      category: "Press release",
      title: "Silver Jubilee Annual Day showcase draws record crowd of parents and alumni",
      date: "02 Sep 2026",
      publishedAt: new Date("2026-09-02T14:00:00Z"),
      location: "Durgapur",
      image: "/photos/culture_1.jpg",
      imageCaption: "Cultural performance during the evening Silver Jubilee festivities.",
      desc: "Celebrating 25 years of educational distinction, the DPS annual showcase captivated an auditorium of over two thousand parents, alumni, and distinguished community educators.",
      lead: "Durgapur, 02 September 2026: Marking a quarter-century of steadfast educational service, Durgapur Public School staged its landmark Silver Jubilee Annual Day Celebration before a capacity gathering.",
      body: [
        "The evening opened with a commemorative address by founding trustees highlighting the school's journey from modest beginnings in 2001 to a modern educational institution serving over 1,800 students.",
        "Students from across classes mounted a thematic cultural presentation spanning classical dance, orchestral harmony, and theatrical tributes to Bengal's literary heritage.",
        "A dedicated Silver Jubilee Commemorative Monograph documenting school milestones, distinguished alumni achievements, and faculty contributions was officially unveiled during the event.",
      ],
      quote: {
        text: "Twenty-five years is a testament to the trust reposed in us by generations of families. We remain committed to nurturing minds that serve society with wisdom and empathy.",
        author: "Governing Council President",
        role: "Durgapur Public School Society",
      },
      author: {
        name: "Cultural Affairs Directorate",
        role: "Events Secretariat",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "Silver Jubilee Commemorative Monograph Preview (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 4800000n,
        },
        {
          title: "Annual Day Program Overview & Order of Events (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 1100000n,
        },
      ],
      relatedSlugs: [
        "faculty-delegation-national-educator-summit",
        "cbse-class-x-results-100-percent",
        "varsity-sports-district-championship",
        "ai-robotics-innovation-lab-launch",
      ],
    },
    {
      slug: "faculty-delegation-national-educator-summit",
      tag: "Academics",
      category: "Press release",
      title: "DPS faculty delegation recognized at National Educator Excellence Summit",
      date: "24 Aug 2026",
      publishedAt: new Date("2026-08-24T08:30:00Z"),
      location: "New Delhi",
      image: "/photos/teachers_day_2.jpg",
      imageCaption: "Faculty representatives honored at the National Educator Summit ceremony.",
      desc: "Five senior faculty members from Durgapur Public School were conferred prestigious honors at the National Educator Summit for pioneering creative and inclusive classroom learning methodologies.",
      lead: "New Delhi, 24 August 2026: Five distinguished educators from Durgapur Public School have been conferred national teaching citations at the 14th National Educator Excellence Summit held in the capital.",
      body: [
        "The awards recognize pedagogical innovation in blended learning, differentiated evaluation techniques for mixed-ability classrooms, and experiential primary mathematics education.",
        "The DPS contingent presented case papers detailing classroom outcomes achieved through interactive lab work and student-led collaborative inquiry.",
        "School authorities expressed immense pride in the achievement, reaffirming continuous institutional support for advanced teacher training and national educational research workshops.",
      ],
      quote: {
        text: "When our educators excel on national forums, they bring that passion directly back into the daily classroom, enriching every student's daily discovery.",
        author: "Smt. M. Ghosh",
        role: "Academic Dean",
      },
      author: {
        name: "Public Relations Desk",
        role: "Press Office",
        email: "info@durgpublicschool.edu.in",
      },
      attachments: [
        {
          title: "National Educator Summit Citation & Case Paper Extracts (pdf)",
          url: "/sample.pdf",
          type: "pdf",
          sizeBytes: 2300000n,
        },
        {
          title: "Summit Press Statement & Delegate Photographs (zip)",
          url: "/sample.pdf",
          type: "zip",
          sizeBytes: 9700000n,
        },
      ],
      relatedSlugs: [
        "cbse-class-x-results-100-percent",
        "silver-jubilee-annual-day",
        "inter-school-science-fair-commences",
        "ai-robotics-innovation-lab-launch",
      ],
    },
  ];

  const articleIdMap = new Map<string, string>();

  for (const art of NEWS_ARTICLES) {
    const article = await prisma.newsArticle.upsert({
      where: { slug: art.slug },
      update: {
        tag: art.tag,
        category: art.category,
        title: art.title,
        dateDisplay: art.date,
        publishedAt: art.publishedAt,
        location: art.location,
        imageKey: art.image,
        imageCaption: art.imageCaption,
        description: art.desc,
        lead: art.lead,
        body: art.body,
        quote: art.quote,
        articleAuthor: art.author,
        isPublished: true,
      },
      create: {
        slug: art.slug,
        tag: art.tag,
        category: art.category,
        title: art.title,
        dateDisplay: art.date,
        publishedAt: art.publishedAt,
        location: art.location,
        imageKey: art.image,
        imageCaption: art.imageCaption,
        description: art.desc,
        lead: art.lead,
        body: art.body,
        quote: art.quote,
        articleAuthor: art.author,
        isPublished: true,
      },
    });

    articleIdMap.set(art.slug, article.id);

    // Seed attachments
    await prisma.newsAttachment.deleteMany({
      where: { articleId: article.id },
    });

    for (let i = 0; i < art.attachments.length; i++) {
      const att = art.attachments[i];
      await prisma.newsAttachment.create({
        data: {
          articleId: article.id,
          title: att.title,
          objectKey: att.url,
          type: att.type,
          sizeBytes: att.sizeBytes,
          sortOrder: i,
        },
      });
    }
  }

  // Seed relations
  for (const art of NEWS_ARTICLES) {
    const sourceId = articleIdMap.get(art.slug);
    if (!sourceId) continue;

    await prisma.newsRelation.deleteMany({
      where: { articleId: sourceId },
    });

    for (let i = 0; i < art.relatedSlugs.length; i++) {
      const targetSlug = art.relatedSlugs[i];
      const targetId = articleIdMap.get(targetSlug);
      if (!targetId || targetId === sourceId) continue;

      await prisma.newsRelation.create({
        data: {
          articleId: sourceId,
          relatedArticleId: targetId,
          sortOrder: i,
        },
      });
    }
  }

  console.log(`✅ Seeded ${NEWS_ARTICLES.length} news articles with attachments and relations.`);

  // 8. Seed Announcements
  console.log("Seeding announcements...");
  await prisma.announcement.deleteMany();

  const announcementsData = [
    {
      textEn: "Special mock test schedule released for Madhyamik & Higher Secondary 2026.",
      textBn: "মাধ্যমিক ও উচ্চ মাধ্যমিক ২০২৬ পরীক্ষার বিশেষ মক টেস্টের সময়সূচি প্রকাশিত হয়েছে।",
      link: "/study-zone",
      severity: "urgent" as const,
      sortOrder: 0,
      isActive: true,
    },
    {
      textEn: "Annual Inter-School Science & Cultural Exhibition to be held on 15th November.",
      textBn: "বার্ষিক আন্তঃবিদ্যালয় বিজ্ঞান ও সাংস্কৃতিক প্রদর্শনী আগামী ১৫ই নভেম্বর অনুষ্ঠিত হবে।",
      link: "/#events",
      severity: "info" as const,
      sortOrder: 1,
      isActive: true,
    },
    {
      textEn: "School quiz team wins 1st prize at the State Inter-School Championship.",
      textBn: "রাজ্যভিত্তিক কুইজ প্রতিযোগিতায় আমাদের বিদ্যালয়ের দল প্রথম স্থান অধিকার করেছে।",
      link: "/#events",
      severity: "info" as const,
      sortOrder: 2,
      isActive: true,
    },
    {
      textEn: "Half-yearly examination schedule is now available to download.",
      textBn: "অর্ধবার্ষিক পরীক্ষার সময়সূচী এখন ডাউনলোডের জন্য উপলব্ধ।",
      link: "/study-zone",
      severity: "warning" as const,
      sortOrder: 3,
      isActive: true,
    },
  ];

  for (const ann of announcementsData) {
    await prisma.announcement.create({
      data: {
        ...ann,
        createdById: admin.id,
      },
    });
  }
  console.log(`✅ Seeded ${announcementsData.length} announcements.`);

  // 6. Seed Faculty Members
  console.log("Seeding faculty members...");
  await prisma.facultyMember.deleteMany({});

  const facultyData = [
    {
      slug: "amitabh-sengupta",
      name: "Dr. Amitabh Sengupta",
      nameBn: "ড. অমিতাভ সেনগুপ্ত",
      designation: "Headmaster",
      designationBn: "প্রধান শিক্ষক",
      department: "Administration",
      education: "M.A. (English), Ph.D., B.Ed.",
      educationBn: "এম.এ. (ইংরেজি), পিএইচ.ডি., বি.এড.",
      description: "Dedicated educator leading Durgapur High School with visionary educational practices.",
      photoKey: "https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=300&q=80",
      sortOrder: 1,
      isActive: true,
    },
    {
      slug: "sharmistha-sen",
      name: "Smt. Sharmistha Sen",
      nameBn: "শ্রীমতী শর্মিষ্ঠা সেন",
      designation: "Assistant Headmistress (Mathematics)",
      designationBn: "সহকারী প্রধান শিক্ষিকা (গণিত)",
      department: "Mathematics",
      education: "M.Sc. (Mathematics), B.Ed.",
      educationBn: "এম.এসসি. (গণিত), বি.এড.",
      description: "Mentoring students in competitive mathematics and academic excellence for over 18 years.",
      photoKey: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80",
      sortOrder: 2,
      isActive: true,
    },
    {
      slug: "subhashish-mukherjee",
      name: "Sri Subhashish Mukherjee",
      nameBn: "শ্রী সুভাষিশ মুখোপাধ্যায়",
      designation: "Assistant Teacher (Physics)",
      designationBn: "সহকারী শিক্ষক (পদার্থবিদ্যা)",
      department: "Science",
      education: "M.Sc. (Physics), B.Ed.",
      educationBn: "এম.এসসি. (পদার্থবিদ্যা), বি.এড.",
      description: "Passionate about experimental physics and conceptual clarity in secondary science.",
      photoKey: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
      sortOrder: 3,
      isActive: true,
    },
    {
      slug: "tanushree-banerjee",
      name: "Dr. Tanushree Banerjee",
      nameBn: "ড. তনুশ্রী ব্যানার্জী",
      designation: "Assistant Teacher (Chemistry)",
      designationBn: "সহকারী শিক্ষিকা (রসায়ন)",
      department: "Science",
      education: "M.Sc. (Chemistry), Ph.D., B.Ed.",
      educationBn: "এম.এসসি. (রসায়ন), পিএইচ.ডি., বি.এড.",
      description: "Guiding students through hands-on chemical laboratories and scientific research mindset.",
      photoKey: "https://images.unsplash.com/photo-1580894732444-8ecded7900cd?auto=format&fit=crop&w=300&q=80",
      sortOrder: 4,
      isActive: true,
    },
    {
      slug: "aniket-roy",
      name: "Sri Aniket Roy",
      nameBn: "শ্রী অনিকেত রায়",
      designation: "Assistant Teacher (Life Science)",
      designationBn: "সহকারী শিক্ষক (জীবনবিজ্ঞান)",
      department: "Science",
      education: "M.Sc. (Zoology), B.Ed.",
      educationBn: "এম.এসসি. (প্রাণিবিদ্যা), বি.এড.",
      description: "Focusing on ecological biodiversity and modern biological sciences.",
      photoKey: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
      sortOrder: 5,
      isActive: true,
    },
    {
      slug: "bhabesh-chandra-das",
      name: "Sri Bhabesh Chandra Das",
      nameBn: "শ্রী ভবেশ চন্দ্র দাস",
      designation: "Assistant Teacher (Bengali)",
      designationBn: "সহকারী শিক্ষক (বাংলা)",
      department: "Language",
      education: "M.A. (Bengali), B.Ed.",
      educationBn: "এম.এ. (বাংলা), বি.এড.",
      description: "Cultivating rich Bengali literature and cultural heritage among students.",
      photoKey: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80",
      sortOrder: 6,
      isActive: true,
    },
    {
      slug: "anuradha-roy",
      name: "Smt. Anuradha Roy",
      nameBn: "শ্রীমতী অনুরাধা রায়",
      designation: "Assistant Teacher (English)",
      designationBn: "সহকারী শিক্ষিকা (ইংরেজি)",
      department: "Language",
      education: "M.A. (English), B.Ed.",
      educationBn: "এম.এ. (ইংরেজি), বি.এড.",
      description: "Fostering English communication, rhetoric and literary appreciation.",
      photoKey: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80",
      sortOrder: 7,
      isActive: true,
    },
    {
      slug: "pradip-kumar-ghoshal",
      name: "Sri Pradip Kumar Ghoshal",
      nameBn: "শ্রী প্রদীপ কুমার ঘোষাল",
      designation: "Assistant Teacher (History)",
      designationBn: "সহকারী শিক্ষক (ইতিহাস)",
      department: "Humanities",
      education: "M.A. (History), B.Ed.",
      educationBn: "এম.এ. (ইতিহাস), বি.এড.",
      description: "Engaging students in critical historical analysis and civilizational evolution.",
      photoKey: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80",
      sortOrder: 8,
      isActive: true,
    },
    {
      slug: "madhumita-dutta",
      name: "Smt. Madhumita Dutta",
      nameBn: "শ্রীমতী মধুমিতা দত্ত",
      designation: "Assistant Teacher (Geography)",
      designationBn: "সহকারী শিক্ষিকা (ভূগোল)",
      department: "Humanities",
      education: "M.Sc. (Geography), B.Ed.",
      educationBn: "এম.এসসি. (ভূগোল), বি.এড.",
      description: "Expert in physical geography, regional mapping, and environmental geography.",
      photoKey: "https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=300&q=80",
      sortOrder: 9,
      isActive: true,
    },
    {
      slug: "poulomi-chatterjee",
      name: "Smt. Poulomi Chatterjee",
      nameBn: "শ্রীমতী পৌলমী চ্যাটার্জী",
      designation: "Assistant Teacher (Computer Application)",
      designationBn: "সহকারী শিক্ষিকা (কম্পিউটার অ্যাপ্লিকেশন)",
      department: "Computer Science",
      education: "MCA, B.Ed.",
      educationBn: "এম.সি.এ., বি.এড.",
      description: "Empowering pupils with algorithmic thinking, digital literacy and coding skills.",
      photoKey: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=300&q=80",
      sortOrder: 10,
      isActive: true,
    },
    {
      slug: "soumen-chakraborty",
      name: "Sri Soumen Chakraborty",
      nameBn: "শ্রী সৌমেন চক্রবর্তী",
      designation: "Assistant Teacher (Physical Education)",
      designationBn: "সহকারী শিক্ষক (শারীরিক শিক্ষা)",
      department: "Physical Education",
      education: "B.P.Ed., M.P.Ed.",
      educationBn: "বি.পি.এড., এম.পি.এড.",
      description: "Instilling discipline, athletics, football, and physical fitness in school teams.",
      photoKey: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80",
      sortOrder: 11,
      isActive: true,
    },
    {
      slug: "rituparna-majumdar",
      name: "Smt. Rituparna Majumdar",
      nameBn: "শ্রীমতী ঋতুপর্ণা মজুমদার",
      designation: "Assistant Teacher (Work Education & Arts)",
      designationBn: "সহকারী শিক্ষিকা (কর্মশিক্ষা ও চারুকলা)",
      department: "Arts & Vocational",
      education: "B.F.A., B.Ed.",
      educationBn: "বি.এফ.এ., বি.এড.",
      description: "Encouraging fine art expression, craft workshops and cultural stage decoration.",
      photoKey: "https://images.unsplash.com/photo-1534751516642-a171ed282186?auto=format&fit=crop&w=300&q=80",
      sortOrder: 12,
      isActive: true,
    },
  ];

  for (const fac of facultyData) {
    await prisma.facultyMember.create({
      data: {
        ...fac,
        createdById: admin.id,
      },
    });
  }
  console.log(`✅ Seeded ${facultyData.length} faculty members.`);

  // 7. Seed Gallery Photos
  console.log("Seeding gallery photos...");
  await prisma.galleryPhoto.deleteMany({});

  const galleryData = [
    {
      title: "Independence Day Celebrations",
      titleBn: "স্বাধীনতা দিবস উদযাপন",
      category: GalleryCategory.celebrations,
      description: "Tricolour unfurled with patriotic songs and ceremonies.",
      photoKey: "/photos/independence_day.jpg",
      sortOrder: 1,
      isActive: true,
    },
    {
      title: "Main Campus Grounds & Assembly",
      titleBn: "মূল ক্যাম্পাস প্রাঙ্গণ ও সমাবেশ",
      category: GalleryCategory.campus,
      description: "Morning prayer and discipline assembly at the central field.",
      photoKey: "/photos/outside_2.jpg",
      sortOrder: 2,
      isActive: true,
    },
    {
      title: "Cultural Program & Performances",
      titleBn: "সাংস্কৃতিক অনুষ্ঠান ও পরিবেশনা",
      category: GalleryCategory.events,
      description: "Students staging Rabindra Nritya and drama.",
      photoKey: "/photos/culture_1.jpg",
      sortOrder: 3,
      isActive: true,
    },
    {
      title: "Annual Cultural Fest",
      titleBn: "বার্ষিক সাংস্কৃতিক উৎসব",
      category: GalleryCategory.events,
      description: "Vibrant festivities celebrating talent and tradition.",
      photoKey: "/photos/culture_2.jpg",
      sortOrder: 4,
      isActive: true,
    },
    {
      title: "School Building & Surrounding Campus",
      titleBn: "বিদ্যালয় ভবন ও পার্শ্ববর্তী ক্যাম্পাস",
      category: GalleryCategory.campus,
      description: "Scenic view of the heritage school building.",
      photoKey: "/photos/outside_3.jpg",
      sortOrder: 5,
      isActive: true,
    },
    {
      title: "Smart Classroom Session",
      titleBn: "স্মার্ট শ্রেণীকক্ষ পাঠদান",
      category: GalleryCategory.academics,
      description: "Digital projection and interactive visual learning.",
      photoKey: "/photos/classroom_1.jpg",
      sortOrder: 6,
      isActive: true,
    },
    {
      title: "Interactive Learning & Engagement",
      titleBn: "ইন্টারেক্টিভ লার্নিং ও সম্পৃক্ততা",
      category: GalleryCategory.academics,
      description: "Collaborative problem-solving and teacher mentorship.",
      photoKey: "/photos/classroom_4.jpg",
      sortOrder: 7,
      isActive: true,
    },
    {
      title: "Student Council & House Groups",
      titleBn: "স্টুডেন্ট কাউন্সিল ও হাউস গ্রুপ",
      category: GalleryCategory.events,
      description: "Leadership teams building camaraderie and school pride.",
      photoKey: "/photos/group_1.jpg",
      sortOrder: 8,
      isActive: true,
    },
    {
      title: "Senior Secondary Lecture Hall",
      titleBn: "উচ্চ মাধ্যমিক লেকচার হল",
      category: GalleryCategory.academics,
      description: "Advanced lectures for Higher Secondary board candidates.",
      photoKey: "/photos/classroom_2.jpg",
      sortOrder: 9,
      isActive: true,
    },
    {
      title: "Collaborative Study Group",
      titleBn: "সহযোগিতামূলক পাঠ চক্র",
      category: GalleryCategory.academics,
      description: "Peer discussion and doubt clearing among pupils.",
      photoKey: "/photos/classroom_3.jpg",
      sortOrder: 10,
      isActive: true,
    },
    {
      title: "Flag Hoisting & March Past",
      titleBn: "জাতীয় পতাকা উত্তোলন ও মার্চ পাস্ট",
      category: GalleryCategory.celebrations,
      description: "NCC cadets and students in rhythmic ceremonial march.",
      photoKey: "/photos/independece_1.jpg",
      sortOrder: 11,
      isActive: true,
    },
    {
      title: "Eco Club Tree Plantation Drive",
      titleBn: "ইকো ক্লাব বৃক্ষরোপণ কর্মসূচি",
      category: GalleryCategory.campus,
      description: "Nurturing saplings to build a greener future.",
      photoKey: "/photos/plantation_1.jpg",
      sortOrder: 12,
      isActive: true,
    },
    {
      title: "Green Campus Initiative",
      titleBn: "সবুজ ক্যাম্পাস উদ্যোগ",
      category: GalleryCategory.campus,
      description: "Environmental stewardship across school grounds.",
      photoKey: "/photos/plantation_2.jpg",
      sortOrder: 13,
      isActive: true,
    },
    {
      title: "Festive Celebrations & Unity",
      titleBn: "উৎসব উদযাপন ও সম্প্রীতি",
      category: GalleryCategory.celebrations,
      description: "Tying Rakhi and spreading peace and fellowship.",
      photoKey: "/photos/rakshabandhan_1.jpg",
      sortOrder: 14,
      isActive: true,
    },
    {
      title: "Teachers' Day Felicitation Ceremony",
      titleBn: "শিক্ষক দিবস সংবর্ধনা অনুষ্ঠান",
      category: GalleryCategory.celebrations,
      description: "Honouring dedicated teachers on Dr. Radhakrishnan's birth anniversary.",
      photoKey: "/photos/teachers_day.jpg",
      sortOrder: 15,
      isActive: true,
    },
    {
      title: "Tribute to Educators & Mentors",
      titleBn: "শিক্ষকদের প্রতি শ্রদ্ধার্ঘ্য",
      category: GalleryCategory.celebrations,
      description: "Flowers and cards presented by heartfelt students.",
      photoKey: "/photos/teachers_day_2.jpg",
      sortOrder: 16,
      isActive: true,
    },
    {
      title: "Faculty & Students Assembly",
      titleBn: "শিক্ষক ও ছাত্রছাত্রীদের সমাবেশ",
      category: GalleryCategory.events,
      description: "Joint assembly celebrating institutional unity.",
      photoKey: "/photos/teachers_day_3.jpg",
      sortOrder: 17,
      isActive: true,
    },
    {
      title: "Science & Innovation Laboratory",
      titleBn: "বিজ্ঞান ও উদ্ভাবন পরীক্ষাগার",
      category: GalleryCategory.academics,
      description: "Practical physics and chemistry experiments under supervision.",
      photoKey: "/photos/science.jpg",
      sortOrder: 18,
      isActive: true,
    },
  ];

  for (const item of galleryData) {
    await prisma.galleryPhoto.create({
      data: {
        ...item,
        createdById: admin.id,
      },
    });
  }
  console.log(`✅ Seeded ${galleryData.length} gallery photos.`);

  console.log("🌱 Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
