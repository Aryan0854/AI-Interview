import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest, isAssessmentOnlyEmployee } from "@/lib/employee-auth";
import { findTopic } from "@/data/learning-curriculum";
import { localTestsDb } from "@/services/local-tests-db";
import { isMissingTestsTableError, getFallbackQuestions, fetchQuestionsFromAI, mapDifficulty } from "@/lib/learning-fallback";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ topicId: string }> }
) {
  try {
    const { topicId } = await params;

    // --- authenticate ---
    const auth = authenticateRequest(request);
    if (!auth?.employeeId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAssessmentOnlyEmployee(auth.employee)) {
      return NextResponse.json(
        { error: "Other learning tests are disabled. Please take your assigned product assessment only." },
        { status: 403 }
      );
    }
    const employeeId = auth.employeeId;

    let employeeUuid = employeeId;
    try {
      const { data: empRow } = await supabase
        .from("employees")
        .select("id")
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (empRow?.id) {
        employeeUuid = empRow.id;
      }
    } catch (e) {
      console.warn("Failed to resolve employee UUID, using raw ID", e);
    }

    // --- read difficulty from body ---
    let difficulty = "medium";
    try {
      const body = await request.json();
      if (body?.difficulty) difficulty = String(body.difficulty);
    } catch {
      // empty body ok
    }

    // --- get topic + subject title ---
    let topicTitle = "";
    let subjectTitle = "";
    let subjId = "";
    let defDiff = difficulty;
    let usingFallback = false;

    try {
      const { data: topicRow, error: topicErr } = await supabase
        .from("learning_topics")
        .select("id, title, module_id, difficulty, estimated_minutes")
        .eq("id", topicId)
        .single();

      if (topicErr || !topicRow) {
        throw topicErr || new Error("Topic not found in database");
      }

      const { data: modRow } = await supabase
        .from("learning_modules")
        .select("subject_id")
        .eq("id", (topicRow as any).module_id)
        .single();

      if (!modRow) throw new Error("Module not found");

      const { data: subjRow } = await supabase
        .from("learning_subjects")
        .select("title")
        .eq("id", (modRow as any).subject_id)
        .single();

      topicTitle = (topicRow as any).title ?? topicId;
      subjectTitle = (subjRow as any).title ?? "";
      subjId = (modRow as any).subject_id ?? "";
      defDiff = (topicRow as any).difficulty ?? difficulty;
    } catch (dbErr) {
      console.warn("Querying catalog from database failed, falling back to static curriculum", dbErr);
      const staticTopic = findTopic(topicId);
      if (!staticTopic) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
      }
      topicTitle = staticTopic.topic.title;
      subjectTitle = staticTopic.subject.title;
      subjId = staticTopic.subject.id;
      defDiff = staticTopic.topic.difficulty;
      usingFallback = true;
    }

    let testId: string;
    let isResume = false;
    let totalQuestions = 10;
    let timeLimitSeconds = 1800;
    let startedAt = new Date().toISOString();

    if (usingFallback) {
      // Use local file-based database for tests
      const existing = await localTestsDb.getTest(employeeId, topicId);
      if (existing) {
        if ((existing.status === "in_progress" || existing.status === "pending") && existing.total_questions === 10) {
          testId = existing.id;
          isResume = true;
          startedAt = existing.started_at || new Date().toISOString();
          await localTestsDb.updateTest(testId, {
            difficulty: defDiff,
            started_at: startedAt
          });
        } else {
          // Completed or count mismatch! Let's reuse & reset it to start fresh and avoid duplicate rows
          testId = existing.id;
          isResume = false;
          startedAt = new Date().toISOString();
          await localTestsDb.updateTest(testId, {
            status: "pending",
            in_progress: null,
            current_question_index: 0,
            started_at: startedAt,
            completed_at: null,
            difficulty: defDiff,
            total_questions: 10
          });
          await localTestsDb.deleteAttempts(testId);
          await localTestsDb.deleteQuestions(testId);

          // Generate questions and insert them into local questions store
          const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
          const mappedQuestions = generated.map((q: any, i: number) => ({
            test_id: testId,
            question_index: i,
            question_text: q.question,
            options: q.options,
            correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
            explanation: q.explanation || "",
            difficulty: q.difficulty || defDiff,
            topic_id: topicId,
            topic_title: topicTitle,
          }));
          await localTestsDb.insertQuestions(mappedQuestions);
        }
      } else {
        const newTest = await localTestsDb.createTest({
          employee_id: employeeId,
          topic_id: topicId,
          subject_id: subjId,
          total_questions: totalQuestions,
          time_limit_seconds: timeLimitSeconds,
          difficulty: defDiff,
          status: "pending",
          current_question_index: 0,
          started_at: startedAt,
          completed_at: null,
          in_progress: null,
          topic_title: topicTitle,
          subject_title: subjectTitle
        });
        testId = newTest.id;

        // Generate questions and insert them into local questions store
        const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
        const mappedQuestions = generated.map((q: any, i: number) => ({
          test_id: testId,
          question_index: i,
          question_text: q.question,
          options: q.options,
          correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
          explanation: q.explanation || "",
          difficulty: q.difficulty || defDiff,
          topic_id: topicId,
          topic_title: topicTitle,
        }));
        await localTestsDb.insertQuestions(mappedQuestions);
      }
    } else {
      // Use Supabase
      try {
        const { data: existing, error: existingError } = await supabase
          .from("tests")
          .select("id, status, total_questions, in_progress, started_at")
          .eq("employee_id", employeeUuid)
          .eq("topic_id", topicId)
          .single();

        if (existingError && isMissingTestsTableError(existingError)) {
          throw existingError; // fallback to catch block below
        }

          if (existing) {
          if ((existing.status === "in_progress" || existing.status === "pending") && existing.total_questions === 10) {
            testId = existing.id;
            isResume = true;
            startedAt = existing.started_at || new Date().toISOString();
            const { error: updateError } = await supabase
               .from("tests")
               .update({ difficulty: defDiff, ...(existing.started_at ? {} : { started_at: startedAt }) })
               .eq("id", testId);
            if (updateError) throw updateError;
          } else {
            // Completed or question count mismatch! Reuse and reset this row to avoid unique constraint violations
            testId = existing.id;
            isResume = false;
            startedAt = new Date().toISOString();
            const { error: updateError } = await supabase
              .from("tests")
              .update({
                status: "pending",
                in_progress: null,
                current_question_index: 0,
                started_at: startedAt,
                completed_at: null,
                difficulty: defDiff,
                total_questions: 10
              })
              .eq("id", testId);
            if (updateError) throw updateError;

            // Delete old attempts and old questions
            await supabase.from("test_attempts").delete().eq("test_id", testId);
            await supabase.from("test_questions").delete().eq("test_id", testId);

            // Generate new questions and insert them into Supabase test_questions
            const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
            const mappedQuestions = generated.map((q: any, i: number) => ({
              test_id: testId,
              question_index: i,
              question_text: q.question,
              options: q.options,
              correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
              explanation: q.explanation || "",
              difficulty: mapDifficulty(q.difficulty || defDiff),
              topic_id: topicId,
              topic_title: topicTitle,
            }));
            const { error: qInsErr } = await supabase.from("test_questions").insert(mappedQuestions);
            if (qInsErr) {
              console.error("Error inserting test questions to Supabase:", qInsErr);
            }
          }
        } else {
          const ins = {
            employee_id: employeeUuid,
            topic_id: topicId,
            subject_id: subjId,
            total_questions: totalQuestions,
            time_limit_seconds: timeLimitSeconds,
            difficulty: defDiff,
            status: "pending",
            created_at: new Date().toISOString(),
          };
          const { data: insRow, error: insErr } = await supabase.from("tests").insert(ins).select("id").single();
          if (insErr || !insRow) {
            throw insErr || new Error("Failed to create test");
          }
          testId = insRow.id;

          // Generate questions and insert them into Supabase test_questions
          const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
          const mappedQuestions = generated.map((q: any, i: number) => ({
            test_id: testId,
            question_index: i,
            question_text: q.question,
            options: q.options,
            correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
            explanation: q.explanation || "",
            difficulty: mapDifficulty(q.difficulty || defDiff),
            topic_id: topicId,
            topic_title: topicTitle,
          }));
          const { error: qInsErr } = await supabase.from("test_questions").insert(mappedQuestions);
          if (qInsErr) {
            console.error("Error inserting test questions to Supabase:", qInsErr);
          }
        }
      } catch (dbErr) {
        console.warn("Supabase tests table missing or query failed. Falling back to local file-based database.", dbErr);
        // Retry locally
        const existing = await localTestsDb.getTest(employeeId, topicId);
        if (existing) {
          if ((existing.status === "in_progress" || existing.status === "pending") && existing.total_questions === 10) {
            testId = existing.id;
            isResume = true;
            startedAt = existing.started_at || new Date().toISOString();
            await localTestsDb.updateTest(testId, {
              difficulty: defDiff,
              started_at: startedAt
            });
          } else {
            // Completed or count mismatch! Let's reuse & reset it to start fresh and avoid duplicate rows
            testId = existing.id;
            isResume = false;
            startedAt = new Date().toISOString();
            await localTestsDb.updateTest(testId, {
              status: "pending",
              in_progress: null,
              current_question_index: 0,
              started_at: startedAt,
              completed_at: null,
              difficulty: defDiff,
              total_questions: 10
            });
            await localTestsDb.deleteAttempts(testId);
            await localTestsDb.deleteQuestions(testId);

            // Generate questions and insert them into local questions store
            const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
            const mappedQuestions = generated.map((q: any, i: number) => ({
              test_id: testId,
              question_index: i,
              question_text: q.question,
              options: q.options,
              correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
              explanation: q.explanation || "",
              difficulty: q.difficulty || defDiff,
              topic_id: topicId,
              topic_title: topicTitle,
            }));
            await localTestsDb.insertQuestions(mappedQuestions);
          }
        } else {
          const newTest = await localTestsDb.createTest({
            employee_id: employeeId,
            topic_id: topicId,
            subject_id: subjId,
            total_questions: totalQuestions,
            time_limit_seconds: timeLimitSeconds,
            difficulty: defDiff,
            status: "pending",
            current_question_index: 0,
            started_at: startedAt,
            completed_at: null,
            in_progress: null,
            topic_title: topicTitle,
            subject_title: subjectTitle
          });
          testId = newTest.id;

          // Generate questions and insert them into local questions store
          const generated = await fetchQuestionsFromAI(subjectTitle, topicTitle, defDiff);
          const mappedQuestions = generated.map((q: any, i: number) => ({
            test_id: testId,
            question_index: i,
            question_text: q.question,
            options: q.options,
            correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
            explanation: q.explanation || "",
            difficulty: q.difficulty || defDiff,
            topic_id: topicId,
            topic_title: topicTitle,
          }));
          await localTestsDb.insertQuestions(mappedQuestions);
        }
      }
    }

    return NextResponse.json({
      test_id: testId,
      isResume,
      topic_title: topicTitle,
      subject_title: subjectTitle,
      difficulty: defDiff,
      total_questions: totalQuestions,
      time_limit_seconds: timeLimitSeconds,
      started_at: startedAt,
    });
  } catch (e: any) {
    console.error("POST /employee/learning/[topicId]/ai-quiz error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}
