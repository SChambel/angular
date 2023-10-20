/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as ir from '../../ir';
import type {CompilationJob, CompilationUnit} from '../compilation';

export function phasePipeCreation(job: CompilationJob): void {
  for (const unit of job.units) {
    processPipeBindingsInView(unit);
  }
}

function processPipeBindingsInView(unit: CompilationUnit): void {
  for (const updateOp of unit.update) {
    ir.visitExpressionsInOp(updateOp, (expr, flags) => {
      if (!ir.isIrExpression(expr)) {
        return;
      }

      if (expr.kind !== ir.ExpressionKind.PipeBinding) {
        return;
      }

      if (flags & ir.VisitorContextFlag.InChildOperation) {
        throw new Error(`AssertionError: pipe bindings should not appear in child expressions`);
      }

      // This update op must be associated with a create op that consumes a slot (either by
      // depending on the ambient context of `target`, or merely referencing that create op via
      // `target`).
      if (!ir.hasDependsOnSlotContextTrait(updateOp) &&
          !ir.hasUsesSlotIndexTrait<ir.UpdateOp>(updateOp)) {
        throw new Error(`AssertionError: pipe binding associated with non-slot operation ${
            ir.OpKind[updateOp.kind]}`);
      }

      if (unit.job.compatibility) {
        addPipeToCreationBlock(unit, updateOp.target, expr);
      } else {
        // When not in compatibility mode, we just add the pipe to the end of the create block. This
        // is not only simpler and faster, but allows more chaining opportunities for other
        // instructions.
        unit.create.push(ir.createPipeOp(expr.target, expr.name));
      }
    });
  }
}

function addPipeToCreationBlock(
    unit: CompilationUnit, afterTargetXref: ir.XrefId, binding: ir.PipeBindingExpr): void {
  // Find the appropriate point to insert the Pipe creation operation.
  // We're looking for `afterTargetXref` (and also want to insert after any other pipe operations
  // which might be beyond it).
  for (let op = unit.create.head.next!; op.kind !== ir.OpKind.ListEnd; op = op.next!) {
    if (!ir.hasConsumesSlotTrait<ir.CreateOp>(op)) {
      continue;
    }

    if (op.xref !== afterTargetXref) {
      continue;
    }

    // We've found a tentative insertion point; however, we also want to skip past any _other_ pipe
    // operations present.
    while (op.next!.kind === ir.OpKind.Pipe) {
      op = op.next!;
    }

    const pipe = ir.createPipeOp(binding.target, binding.name) as ir.CreateOp;
    ir.OpList.insertBefore(pipe, op.next!);

    // This completes adding the pipe to the creation block.
    return;
  }

  // At this point, we've failed to add the pipe to the creation block.
  throw new Error(`AssertionError: unable to find insertion point for pipe ${binding.name}`);
}
