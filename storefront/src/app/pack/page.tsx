import { redirect } from 'next/navigation';

/**
 * The packing screen grew into the full order admin. One door is better than
 * two, so this keeps the old link working rather than leaving a second,
 * poorer version of the same screen behind.
 */
export default function PackPage() {
  redirect('/admin');
}
