import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadDefaultProfile } from '@/qualification/engine';
import { loadAnswerBank } from '@/llm/ollama';

export async function GET() {
  try {
    const profile = loadDefaultProfile();
    const answerBank = loadAnswerBank();

    return NextResponse.json({
      success: true,
      data: {
        profile,
        answerBank,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read profile data' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { profile, answerBank } = body;

    if (profile) {
      const profilePath = path.resolve(process.cwd(), 'data', 'profile.json');
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
    }

    if (answerBank) {
      const bankPath = path.resolve(process.cwd(), 'data', 'answer-bank.json');
      fs.writeFileSync(bankPath, JSON.stringify(answerBank, null, 2), 'utf-8');
    }

    return NextResponse.json({
      success: true,
      message: 'Profile and configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
