import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, signToken, setSessionCookie, toSafeUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const user = db.users.findByEmail(email);

    if (!user) {
      // On serverless (Vercel) the in-memory DB is wiped between lambda instances.
      // If the user registered in a different lambda invocation, their record won't
      // exist here. Return a clear message instead of a confusing "wrong password".
      return NextResponse.json({
        error: 'Account not found in this session. On the hosted demo, please sign up again — data resets between server instances. For persistent accounts, self-host with a database.',
      }, { status: 401 });
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    // Embed name + plan in JWT so the session is self-contained on serverless
    const token = signToken({ userId: user.id, email: user.email, name: user.name, plan: user.plan });
    await setSessionCookie(token);

    return NextResponse.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error('[login]', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
