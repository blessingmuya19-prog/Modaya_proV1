import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { db } from '@/lib/db';
import { hashPassword, signToken, setSessionCookie, toSafeUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (db.users.findByEmail(email)) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }

    const user = db.users.create({
      id:            uuid(),
      email:         email.trim().toLowerCase(),
      name:          name.trim(),
      passwordHash:  await hashPassword(password),
      createdAt:     new Date().toISOString(),
      plan:          'starter',
      storageUsedMb: 0,
    });

    // Embed name + plan in JWT so the session is self-contained on serverless
    const token = signToken({ userId: user.id, email: user.email, name: user.name, plan: user.plan });
    await setSessionCookie(token);

    return NextResponse.json({ user: toSafeUser(user) }, { status: 201 });
  } catch (err) {
    console.error('[register]', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
