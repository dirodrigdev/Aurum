import { refreshGastappMonthlyContable, resolveGastappMonthlyCloseCandidate } from './gastosMonthly';
import { acceptGastappMonthlyClosureRevision, loadClosures } from './wealthStorage';

const comparisonChanged = 'La revisión cambió o aún no está certificada. Actualiza la comparación.';

/** The accepted revision must be the exact version the customer reviewed. */
export const acceptReviewedGastappRevision = async (input: {
  monthKey: string;
  expectedPreviousContractHash: string;
  expectedCandidateContractHash: string;
}) => {
  const readReviewedClosure = () => {
    const closure = loadClosures().find((item) => item.monthKey === input.monthKey);
    if (!closure?.gastappExpenseClose) {
      throw new Error('No encontré el snapshot de GastApp guardado para este cierre.');
    }
    if (closure.gastappExpenseClose.contractHash !== input.expectedPreviousContractHash) {
      throw new Error(comparisonChanged);
    }
    return closure;
  };
  readReviewedClosure();
  await refreshGastappMonthlyContable();
  const closure = readReviewedClosure();
  const candidate = resolveGastappMonthlyCloseCandidate(input.monthKey, {
    previousSnapshot: closure.gastappExpenseClose,
  });
  if (!candidate.snapshot || !candidate.sourceChangedAfterClosure) {
    throw new Error(candidate.message || comparisonChanged);
  }
  if (candidate.snapshot.contractHash !== input.expectedCandidateContractHash) {
    throw new Error(comparisonChanged);
  }
  return acceptGastappMonthlyClosureRevision({ ...input, snapshot: candidate.snapshot });
};
